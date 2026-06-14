import type { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { FeatureFlag, PlanType } from '@queuenow/shared-types';

import { PlanLimitsService } from '../../modules/plan/plan-limits.service';
import type { PrismaService } from '../../prisma/prisma.service';
import { OrgNotFoundException } from '../exceptions/org-not-found.exception';
import { PlanLimitExceededException } from '../exceptions/plan-limit-exceeded.exception';
import { PlanFeatureGuard } from './plan-feature.guard';

/**
 * Task 8.4 — unit tests for guard ordering and error paths.
 *
 * The unit under test is {@link PlanFeatureGuard}. It resolves an org context
 * from `req.params.orgId ?? req.user.orgId`, validates the org exists BEFORE the
 * feature check (so `ORG_NOT_FOUND` takes precedence, R3.4), then rejects with
 * `PLAN_LIMIT_EXCEEDED` when the resolved plan disables the required flag
 * (R3.1 / R4.1) or permits the request when the flag is enabled.
 *
 * Requirements: 3.1, 3.3, 3.4, 4.1, 4.3.
 */

/** The minimal request shape the guard reads. */
interface StubRequest {
  params?: { orgId?: string };
  user?: { orgId?: string };
}

/** Build a typed {@link ExecutionContext} stub returning the given request. */
function makeContext(request: StubRequest): ExecutionContext {
  const handler = (): void => undefined;
  class StubController {}
  return {
    switchToHttp: () => ({
      getRequest: <T>(): T => request as T,
    }),
    getHandler: () => handler,
    getClass: () => StubController,
  } as unknown as ExecutionContext;
}

/** A reflector that always resolves the configured feature flag (or undefined). */
function makeReflector(flag: FeatureFlag | undefined): Reflector {
  const reflector = new Reflector();
  jest
    .spyOn(reflector, 'getAllAndOverride')
    .mockReturnValue(flag as unknown as ReturnType<Reflector['getAllAndOverride']>);
  return reflector;
}

/**
 * Build a typed PrismaService stub whose `organization.findUnique` resolves to
 * the given plan (or `null` for an unknown org). Returns the stub plus the jest
 * mock so tests can assert call behaviour.
 */
function makePrisma(plan: PlanType | null): {
  prisma: PrismaService;
  findUnique: jest.Mock;
} {
  const findUnique = jest.fn().mockResolvedValue(plan === null ? null : { plan });
  const prisma = {
    organization: { findUnique },
  } as unknown as PrismaService;
  return { prisma, findUnique };
}

/** The real (pure) PlanLimitsService; its `isFeatureEnabled` ignores Prisma. */
function makePlanLimits(): PlanLimitsService {
  return new PlanLimitsService({} as unknown as PrismaService);
}

/** Run the guard and capture the thrown error (fails the test if none is thrown). */
async function captureError(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error('Expected canActivate to reject, but it resolved.');
}

describe('PlanFeatureGuard', () => {
  describe('TV Display (tvDisplay flag, orgId from req.params)', () => {
    // R3.4 — unknown org is decided before the feature check.
    it('throws ORG_NOT_FOUND for an unknown orgId (precedence over feature check)', async () => {
      const planLimits = makePlanLimits();
      const isFeatureEnabled = jest.spyOn(planLimits, 'isFeatureEnabled');
      const { prisma } = makePrisma(null);
      const guard = new PlanFeatureGuard(makeReflector('tvDisplay'), planLimits, prisma);

      await expect(
        guard.canActivate(makeContext({ params: { orgId: 'unknown-org' } })),
      ).rejects.toBeInstanceOf(OrgNotFoundException);
      // Precedence: the feature check must never run for an unknown org.
      expect(isFeatureEnabled).not.toHaveBeenCalled();
    });

    // R3.1 — disabled flag yields PLAN_LIMIT_EXCEEDED with feature details.
    it('throws PLAN_LIMIT_EXCEEDED with {flag, plan} when tvDisplay is disabled (FREE)', async () => {
      const { prisma } = makePrisma('FREE');
      const guard = new PlanFeatureGuard(makeReflector('tvDisplay'), makePlanLimits(), prisma);

      const error = await captureError(
        guard.canActivate(makeContext({ params: { orgId: 'org-free' } })),
      );
      expect(error).toBeInstanceOf(PlanLimitExceededException);
      expect((error as PlanLimitExceededException).getResponse()).toMatchObject({
        code: 'PLAN_LIMIT_EXCEEDED',
        details: { flag: 'tvDisplay', plan: 'FREE' },
      });
    });

    // R3.1 — enabled flag permits the request.
    it('returns true when tvDisplay is enabled (BASIC)', async () => {
      const { prisma } = makePrisma('BASIC');
      const guard = new PlanFeatureGuard(makeReflector('tvDisplay'), makePlanLimits(), prisma);

      await expect(
        guard.canActivate(makeContext({ params: { orgId: 'org-basic' } })),
      ).resolves.toBe(true);
    });

    it('returns true when tvDisplay is enabled (PRO)', async () => {
      const { prisma } = makePrisma('PRO');
      const guard = new PlanFeatureGuard(makeReflector('tvDisplay'), makePlanLimits(), prisma);

      await expect(guard.canActivate(makeContext({ params: { orgId: 'org-pro' } }))).resolves.toBe(
        true,
      );
    });
  });

  describe('Analytics (analytics flag, orgId from req.user — no params)', () => {
    // R3.3 — JWT-resolved orgId is evaluated identically to a param-resolved one.
    it('resolves orgId from req.user.orgId and throws PLAN_LIMIT_EXCEEDED when analytics is disabled (FREE)', async () => {
      const { prisma, findUnique } = makePrisma('FREE');
      const guard = new PlanFeatureGuard(makeReflector('analytics'), makePlanLimits(), prisma);

      const error = await captureError(
        guard.canActivate(makeContext({ user: { orgId: 'org-free' } })),
      );
      expect(error).toBeInstanceOf(PlanLimitExceededException);
      expect((error as PlanLimitExceededException).getResponse()).toMatchObject({
        code: 'PLAN_LIMIT_EXCEEDED',
        details: { flag: 'analytics', plan: 'FREE' },
      });
      expect(findUnique).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'org-free' } }),
      );
    });

    it('returns true when analytics is enabled (PRO)', async () => {
      const { prisma } = makePrisma('PRO');
      const guard = new PlanFeatureGuard(makeReflector('analytics'), makePlanLimits(), prisma);

      await expect(guard.canActivate(makeContext({ user: { orgId: 'org-pro' } }))).resolves.toBe(
        true,
      );
    });

    // R4.3 — anonymous analytics requests are rejected with AUTH_UNAUTHORIZED by
    // the JwtAuthGuard that runs UPSTREAM of this guard (controller-level), so the
    // request never reaches PlanFeatureGuard without auth. This guard's own
    // behaviour when no org context can be resolved (neither params.orgId nor
    // user.orgId) is to throw ORG_NOT_FOUND before any DB/feature work.
    it('throws ORG_NOT_FOUND when no org context can be resolved (anonymous, no params/user)', async () => {
      const planLimits = makePlanLimits();
      const isFeatureEnabled = jest.spyOn(planLimits, 'isFeatureEnabled');
      const { prisma, findUnique } = makePrisma(null);
      const guard = new PlanFeatureGuard(makeReflector('analytics'), planLimits, prisma);

      await expect(guard.canActivate(makeContext({}))).rejects.toBeInstanceOf(OrgNotFoundException);
      // No org context ⇒ no DB lookup and no feature evaluation.
      expect(findUnique).not.toHaveBeenCalled();
      expect(isFeatureEnabled).not.toHaveBeenCalled();
    });
  });

  describe('pass-through', () => {
    // No @RequiresFeature metadata ⇒ nothing to enforce.
    it('returns true when no feature flag metadata is present', async () => {
      const planLimits = makePlanLimits();
      const isFeatureEnabled = jest.spyOn(planLimits, 'isFeatureEnabled');
      const { prisma, findUnique } = makePrisma('FREE');
      const guard = new PlanFeatureGuard(makeReflector(undefined), planLimits, prisma);

      await expect(guard.canActivate(makeContext({ params: { orgId: 'org-free' } }))).resolves.toBe(
        true,
      );
      expect(findUnique).not.toHaveBeenCalled();
      expect(isFeatureEnabled).not.toHaveBeenCalled();
    });
  });
});
