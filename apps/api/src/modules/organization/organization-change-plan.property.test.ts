import fc from 'fast-check';

import { PLAN_LIMITS } from '@queuenow/shared-constants';
import { PlanType } from '@queuenow/shared-types';

import { PrismaService } from '../../prisma/prisma.service';
import { PlanLimitsService } from '../plan/plan-limits.service';
import { OrganizationService } from './organization.service';

// ---------------------------------------------------------------------------
// Typed in-memory PrismaService mock for OrganizationService.changePlan.
//
// `organization.findUnique` returns the org with the currently persisted plan;
// `organization.update` mutates that persisted plan and returns the updated
// org (simulating persistence). This lets us verify both idempotence
// ("applying twice == once") and that later enforcement reads the new plan.
// ---------------------------------------------------------------------------

interface OrgRecord {
  id: string;
  name: string;
  plan: PlanType;
}

interface PrismaMock {
  prisma: PrismaService;
  findUnique: jest.Mock;
  update: jest.Mock;
  /** The plan currently persisted in the in-memory store. */
  persistedPlan: () => PlanType;
}

function makePrismaMock(orgId: string, initialPlan: PlanType): PrismaMock {
  let currentPlan: PlanType = initialPlan;

  const findUnique = jest.fn(
    async ({ where }: { where: { id: string } }): Promise<OrgRecord | null> =>
      where.id === orgId ? { id: orgId, name: 'Test Org', plan: currentPlan } : null,
  );

  const update = jest.fn(
    async ({
      where,
      data,
    }: {
      where: { id: string };
      data: { plan: PlanType };
    }): Promise<OrgRecord> => {
      if (where.id !== orgId) {
        throw new Error(`Unexpected update for org ${where.id}`);
      }
      currentPlan = data.plan;
      return { id: orgId, name: 'Test Org', plan: currentPlan };
    },
  );

  const prisma = {
    organization: { findUnique, update },
  } as unknown as PrismaService;

  return { prisma, findUnique, update, persistedPlan: () => currentPlan };
}

// PlanLimitsService.limitsFor is a pure policy method that never touches Prisma,
// so an empty stub is sufficient to model "later enforcement".
const planLimits = new PlanLimitsService({} as unknown as PrismaService);

const PLANS: PlanType[] = Object.values(PlanType);
const planArb = (): fc.Arbitrary<PlanType> => fc.constantFrom(...PLANS);
const orgIdArb = (): fc.Arbitrary<string> => fc.uuid();

const NUM_RUNS = 200;

// Feature: plan-limit-enforcement, Property 8: Plan change sets the target, is idempotent, and governs later decisions
describe('Property 8: Plan change sets the target, is idempotent, and governs later decisions', () => {
  // Validates: Requirements 6.1, 6.6, 6.7
  it('sets the result plan to the target and later enforcement uses the target plan limits', async () => {
    await fc.assert(
      fc.asyncProperty(orgIdArb(), planArb(), planArb(), async (orgId, current, target) => {
        const { prisma, update, persistedPlan } = makePrismaMock(orgId, current);
        const service = new OrganizationService(prisma);

        const result = await service.changePlan(orgId, target, orgId);

        // R6.1: the result organization's plan equals the target plan.
        expect(result.plan).toBe(target);
        // The persisted plan reflects the target after the change.
        expect(persistedPlan()).toBe(target);

        // R6.7: every enforcement decision evaluated after the change uses the
        // target plan's limits — modeled by resolving limits from the now
        // persisted plan, which must equal PLAN_LIMITS[target].
        expect(planLimits.limitsFor(persistedPlan())).toEqual(PLAN_LIMITS[target]);

        // update() persists only when the target differs from the current plan.
        if (target === current) {
          expect(update).not.toHaveBeenCalled();
        } else {
          expect(update).toHaveBeenCalledTimes(1);
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('is a no-op when the target equals the current plan (returns unchanged org, no error, no write)', async () => {
    // R6.6
    await fc.assert(
      fc.asyncProperty(orgIdArb(), planArb(), async (orgId, plan) => {
        const { prisma, findUnique, update, persistedPlan } = makePrismaMock(orgId, plan);
        const service = new OrganizationService(prisma);

        const result = await service.changePlan(orgId, plan, orgId);

        // Returned unchanged without error, and no persistence write occurred.
        expect(result.plan).toBe(plan);
        expect(persistedPlan()).toBe(plan);
        expect(update).not.toHaveBeenCalled();

        // The returned org is the one loaded via findUnique (idempotent path).
        const loaded = await findUnique.mock.results[0]?.value;
        expect(result).toEqual(loaded);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('is idempotent: applying the same change twice yields the same result as applying it once', async () => {
    // R6.6 / R6.1 — idempotence of the persisted plan.
    await fc.assert(
      fc.asyncProperty(orgIdArb(), planArb(), planArb(), async (orgId, current, target) => {
        // Apply the change once.
        const once = makePrismaMock(orgId, current);
        const serviceOnce = new OrganizationService(once.prisma);
        const resultOnce = await serviceOnce.changePlan(orgId, target, orgId);
        const planAfterOnce = once.persistedPlan();

        // Apply the same change twice (against a fresh store with the same start).
        const twice = makePrismaMock(orgId, current);
        const serviceTwice = new OrganizationService(twice.prisma);
        const firstResult = await serviceTwice.changePlan(orgId, target, orgId);
        const resultTwice = await serviceTwice.changePlan(orgId, target, orgId);
        const planAfterTwice = twice.persistedPlan();

        // Applying twice == once: same final result plan and same persisted plan.
        expect(resultTwice.plan).toBe(resultOnce.plan);
        expect(planAfterTwice).toBe(planAfterOnce);
        expect(planAfterTwice).toBe(target);

        // The intermediate (first) application already reached the target, so
        // the second application is a no-op on the persisted plan.
        expect(firstResult.plan).toBe(target);
        expect(planAfterTwice).toBe(firstResult.plan);
      }),
      { numRuns: NUM_RUNS },
    );
  });
});
