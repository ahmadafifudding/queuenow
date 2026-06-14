import 'reflect-metadata';

import { ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PlanType } from '@queuenow/shared-types';

import { OrgNotFoundException } from '../../common/exceptions/org-not-found.exception';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import type { PrismaService } from '../../prisma/prisma.service';
import { OrganizationController } from './organization.controller';
import { OrganizationService } from './organization.service';

/**
 * Task 9.5 — auth and validation error paths for the manual plan-change
 * endpoint, plus the grandfathering invariant (R5.3).
 *
 * Where each error originates:
 * - `AUTH_FORBIDDEN` for ADMIN/STAFF (R6.2) and `AUTH_UNAUTHORIZED` for
 *   anonymous (R6.3) are produced by the controller-level `JwtAuthGuard` +
 *   `RolesGuard('OWNER')` that run UPSTREAM of the handler — never inside the
 *   service. These are asserted at the metadata level (the `@Roles('OWNER')`
 *   binding and the class-level guard chain) since the guards themselves are
 *   covered by their own specs. The service's own org-scope `validateAccess`
 *   (a second `ForbiddenException` boundary) is also exercised directly.
 * - `VALIDATION_ERROR` for a non-enum target (R6.4) is covered by
 *   `dto/change-plan.dto.spec.ts`.
 * - `ORG_NOT_FOUND` for a missing org (R6.5) and the no-side-effects /
 *   grandfathering invariant (R5.3) are unit-tested against `changePlan` here.
 *
 * _Requirements: 6.2, 6.3, 6.4, 6.5, 5.3_
 */

const ORG_ID = 'org-1';

interface OrgRow {
  id: string;
  plan: PlanType;
  name: string;
}

/**
 * Build a typed {@link PrismaService} stub. `organization.findUnique` resolves
 * to the given row (or `null` for a missing org); `organization.update` echoes
 * the patched row. Destructive operations on the resources a downgrade would
 * "exceed" are stubbed so a test can assert they are NEVER invoked (R5.3).
 */
function makePrisma(org: OrgRow | null): {
  prisma: PrismaService;
  organizationFindUnique: jest.Mock;
  organizationUpdate: jest.Mock;
  destructive: jest.Mock[];
} {
  const organizationFindUnique = jest.fn().mockResolvedValue(org);
  const organizationUpdate = jest
    .fn()
    .mockImplementation(({ where, data }: { where: { id: string }; data: { plan: PlanType } }) =>
      Promise.resolve({ ...(org ?? { id: where.id, name: 'org' }), ...data }),
    );

  // Any of these being called would mean a plan change mutated existing
  // resources — which R5.3 forbids. They must remain untouched.
  const serviceDeleteMany = jest.fn();
  const serviceUpdateMany = jest.fn();
  const counterDeleteMany = jest.fn();
  const counterUpdateMany = jest.fn();
  const userRoleDeleteMany = jest.fn();
  const queueTicketDeleteMany = jest.fn();

  const prisma = {
    organization: { findUnique: organizationFindUnique, update: organizationUpdate },
    service: { deleteMany: serviceDeleteMany, updateMany: serviceUpdateMany },
    counter: { deleteMany: counterDeleteMany, updateMany: counterUpdateMany },
    userRole: { deleteMany: userRoleDeleteMany },
    queueTicket: { deleteMany: queueTicketDeleteMany },
  } as unknown as PrismaService;

  return {
    prisma,
    organizationFindUnique,
    organizationUpdate,
    destructive: [
      serviceDeleteMany,
      serviceUpdateMany,
      counterDeleteMany,
      counterUpdateMany,
      userRoleDeleteMany,
      queueTicketDeleteMany,
    ],
  };
}

describe('OrganizationService.changePlan — error paths and grandfathering (R5.3, R6.5)', () => {
  it('throws ORG_NOT_FOUND for a missing org and leaves the plan unchanged', async () => {
    const { prisma, organizationFindUnique, organizationUpdate } = makePrisma(null);
    const service = new OrganizationService(prisma);

    await expect(service.changePlan(ORG_ID, PlanType.PRO, ORG_ID)).rejects.toBeInstanceOf(
      OrgNotFoundException,
    );

    expect(organizationFindUnique).toHaveBeenCalledTimes(1);
    // Plan unchanged: no update is attempted when the org does not exist (R6.5).
    expect(organizationUpdate).not.toHaveBeenCalled();
  });

  it('rejects a cross-org request with ForbiddenException before any DB access', async () => {
    const { prisma, organizationFindUnique, organizationUpdate } = makePrisma({
      id: ORG_ID,
      plan: PlanType.FREE,
      name: 'Acme',
    });
    const service = new OrganizationService(prisma);

    // A user whose orgId differs from the target id (the org-scope boundary the
    // service enforces in addition to the OWNER role guard).
    await expect(service.changePlan(ORG_ID, PlanType.PRO, 'other-org')).rejects.toBeInstanceOf(
      ForbiddenException,
    );

    expect(organizationFindUnique).not.toHaveBeenCalled();
    expect(organizationUpdate).not.toHaveBeenCalled();
  });

  it('persists the target plan via a single organization.update with exactly { plan } (R5.3)', async () => {
    const org: OrgRow = { id: ORG_ID, plan: PlanType.FREE, name: 'Acme' };
    const { prisma, organizationUpdate, destructive } = makePrisma(org);
    const service = new OrganizationService(prisma);

    const result = await service.changePlan(ORG_ID, PlanType.PRO, ORG_ID);

    expect(result.plan).toBe(PlanType.PRO);
    // The ONLY mutation is the plan column on the org row.
    expect(organizationUpdate).toHaveBeenCalledTimes(1);
    expect(organizationUpdate).toHaveBeenCalledWith({
      where: { id: ORG_ID },
      data: { plan: PlanType.PRO },
    });
    // Existing resources are never deleted/deactivated — they remain
    // readable/updatable after a plan change, including a downgrade (R5.3).
    for (const mutation of destructive) {
      expect(mutation).not.toHaveBeenCalled();
    }
  });

  it('is idempotent when the target equals the current plan (no update, no side effects)', async () => {
    const org: OrgRow = { id: ORG_ID, plan: PlanType.PRO, name: 'Acme' };
    const { prisma, organizationUpdate, destructive } = makePrisma(org);
    const service = new OrganizationService(prisma);

    const result = await service.changePlan(ORG_ID, PlanType.PRO, ORG_ID);

    expect(result).toBe(org);
    expect(organizationUpdate).not.toHaveBeenCalled();
    for (const mutation of destructive) {
      expect(mutation).not.toHaveBeenCalled();
    }
  });

  it('does not delete or deactivate over-limit resources on a downgrade (R5.3)', async () => {
    // FREE has the tightest limits, so PRO → FREE is the canonical "downgrade
    // that leaves usage over the new limit" case. The service must not touch
    // existing rows.
    const org: OrgRow = { id: ORG_ID, plan: PlanType.PRO, name: 'Acme' };
    const { prisma, organizationUpdate, destructive } = makePrisma(org);
    const service = new OrganizationService(prisma);

    const result = await service.changePlan(ORG_ID, PlanType.FREE, ORG_ID);

    expect(result.plan).toBe(PlanType.FREE);
    expect(organizationUpdate).toHaveBeenCalledWith({
      where: { id: ORG_ID },
      data: { plan: PlanType.FREE },
    });
    for (const mutation of destructive) {
      expect(mutation).not.toHaveBeenCalled();
    }
  });
});

/**
 * `AUTH_FORBIDDEN` (R6.2) and `AUTH_UNAUTHORIZED` (R6.3) are enforced by the
 * controller-level guard chain, not the service. These assertions pin the
 * routing metadata so the endpoint stays OWNER-only behind authentication:
 *   - `@Roles('OWNER')` ⇒ `RolesGuard` rejects ADMIN/STAFF with AUTH_FORBIDDEN.
 *   - class-level `@UseGuards(JwtAuthGuard, RolesGuard)` ⇒ anonymous requests
 *     are rejected by `JwtAuthGuard` with AUTH_UNAUTHORIZED before `RolesGuard`.
 */
describe('PATCH /organizations/:id/plan auth bindings (R6.2, R6.3)', () => {
  const GUARDS_METADATA_KEY = '__guards__';

  it('binds @Roles("OWNER") to the changePlan handler (non-OWNER ⇒ AUTH_FORBIDDEN)', () => {
    const reflector = new Reflector();

    const roles = reflector.get<string[]>('roles', OrganizationController.prototype.changePlan);

    expect(roles).toEqual(['OWNER']);
    // ADMIN/STAFF are NOT in the allow-list, so RolesGuard rejects them (R6.2).
    expect(roles).not.toContain('ADMIN');
    expect(roles).not.toContain('STAFF');
  });

  it('guards the controller with JwtAuthGuard then RolesGuard (anonymous ⇒ AUTH_UNAUTHORIZED)', () => {
    const guards = Reflect.getMetadata(GUARDS_METADATA_KEY, OrganizationController) as
      | unknown[]
      | undefined;

    expect(guards).toBeDefined();
    expect(guards).toContain(JwtAuthGuard);
    expect(guards).toContain(RolesGuard);
    // JwtAuthGuard runs first, so an unauthenticated request is rejected with
    // AUTH_UNAUTHORIZED before the role check ever runs (R6.3).
    const guardList = guards as unknown[];
    expect(guardList.indexOf(JwtAuthGuard)).toBeLessThan(guardList.indexOf(RolesGuard));
  });
});
