import fc from 'fast-check';

import { ERROR_CODES, PLAN_LIMITS } from '@queuenow/shared-constants';
import { PlanType } from '@queuenow/shared-types';
import type { FeatureFlag, NumericResource } from '@queuenow/shared-types';

import { PrismaService } from '../../prisma/prisma.service';
import { PlanLimitsService, decideNumericLimit } from './plan-limits.service';

// A bare PlanLimitsService is sufficient for the pure policy methods under test:
// they never touch Prisma. Passing an empty stub keeps these tests free of any
// database dependency (matches the design's in-memory enforcement model).
const service = new PlanLimitsService({} as unknown as PrismaService);

const PLANS: PlanType[] = Object.values(PlanType);
const NUMERIC_RESOURCES: NumericResource[] = ['services', 'counters', 'staff', 'queuePerDay'];
const FEATURE_FLAGS: FeatureFlag[] = ['tvDisplay', 'analytics', 'customBranding'];

const plan = (): fc.Arbitrary<PlanType> => fc.constantFrom(...PLANS);
const numericResource = (): fc.Arbitrary<NumericResource> => fc.constantFrom(...NUMERIC_RESOURCES);
const featureFlag = (): fc.Arbitrary<FeatureFlag> => fc.constantFrom(...FEATURE_FLAGS);
const usage = (): fc.Arbitrary<number> => fc.nat({ max: 10_000 });

const NUM_RUNS = 200;

// Feature: plan-limit-enforcement, Property 1: Numeric-limit decision is allow-iff-below-limit
describe('Property 1: Numeric-limit decision is allow-iff-below-limit', () => {
  // Validates: Requirements 1.1, 1.2, 1.4, 1.5, 2.1, 2.2, 2.3, 5.2, 5.6
  it('ALLOWs when the resolved limit is null (unlimited) or usage < limit, REJECTs otherwise', () => {
    fc.assert(
      fc.property(plan(), numericResource(), usage(), (p, resource, currentUsage) => {
        const { limitName, limit } = service.numericLimitFor(p, resource);

        // The resolved limit must be the governing PLAN_LIMITS field for the plan.
        expect(limit).toBe(PLAN_LIMITS[p][limitName]);

        const decision = decideNumericLimit(limit, currentUsage);

        if (limit === null || currentUsage < limit) {
          expect(decision.allow).toBe(true);
        } else {
          expect(decision.allow).toBe(false);
          // Narrow the union to access the rejection code.
          if (!decision.allow) {
            expect(decision.code).toBe(ERROR_CODES.PLAN_LIMIT_EXCEEDED);
          }
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('REJECTs exactly at the boundary (usage === limit) and ALLOWs one below it', () => {
    // Restrict to plan/resource combinations whose limit is a concrete number.
    const boundedArb = fc
      .tuple(plan(), numericResource())
      .filter(([p, resource]) => service.numericLimitFor(p, resource).limit !== null);

    fc.assert(
      fc.property(boundedArb, ([p, resource]) => {
        const { limit } = service.numericLimitFor(p, resource);
        const numericLimit = limit as number;

        expect(decideNumericLimit(numericLimit, numericLimit).allow).toBe(false);
        if (numericLimit > 0) {
          expect(decideNumericLimit(numericLimit, numericLimit - 1).allow).toBe(true);
        }
        // Anything above the limit is also rejected.
        expect(decideNumericLimit(numericLimit, numericLimit + 1).allow).toBe(false);
      }),
      { numRuns: NUM_RUNS },
    );
  });
});

// Feature: plan-limit-enforcement, Property 5: Feature gate permits iff the plan enables the flag, independent of auth source
describe('Property 5: Feature gate permits iff the plan enables the flag, independent of auth source', () => {
  // Validates: Requirements 3.1, 3.2, 3.3, 4.1, 4.2
  it('permits access iff the resolved plan enables the flag', () => {
    fc.assert(
      fc.property(plan(), featureFlag(), (p, flag) => {
        expect(service.isFeatureEnabled(p, flag)).toBe(PLAN_LIMITS[p][flag]);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('decides only from the plan, identically for param-resolved and JWT-resolved orgId', () => {
    // The decision is a pure function of (plan, flag). We model two auth sources
    // resolving the SAME org plan and assert the decisions are identical, then
    // model a different plan and assert the decision tracks the plan alone.
    fc.assert(
      fc.property(plan(), plan(), featureFlag(), (planFromParam, planFromJwt, flag) => {
        const fromParam = service.isFeatureEnabled(planFromParam, flag);
        const fromJwt = service.isFeatureEnabled(planFromJwt, flag);

        // Same resolved plan ⇒ same decision regardless of how orgId was resolved.
        expect(service.isFeatureEnabled(planFromParam, flag)).toBe(fromParam);

        // The decision depends only on the resolved plan's flag value.
        expect(fromParam).toBe(PLAN_LIMITS[planFromParam][flag]);
        expect(fromJwt).toBe(PLAN_LIMITS[planFromJwt][flag]);
        if (planFromParam === planFromJwt) {
          expect(fromParam).toBe(fromJwt);
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });
});
