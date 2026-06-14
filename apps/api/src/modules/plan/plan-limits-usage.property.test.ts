// Feature: plan-limit-enforcement, Property 2: Usage never exceeds the limit and rejects leave usage unchanged

import fc from 'fast-check';

import { ERROR_CODES } from '@queuenow/shared-constants';
import { PlanType } from '@queuenow/shared-types';
import type { NumericResource } from '@queuenow/shared-types';

import type { PrismaService } from '../../prisma/prisma.service';
import { PlanLimitsService, decideNumericLimit } from './plan-limits.service';

/**
 * Property 2 — Usage never exceeds the limit and rejects leave usage unchanged.
 * Validates: Requirements 1.3, 1.6, 5.6
 *
 * For any initial usage and any sequence (including interleavings) of create
 * attempts and deletions applied to the in-memory enforcement model for a fixed
 * plan and resource:
 *   (A) the committed usage never exceeds the numeric limit;
 *   (B) every rejected create returns `PLAN_LIMIT_EXCEEDED` and leaves usage
 *       unchanged; and
 *   (C) any deletion that brings usage below the limit makes the next create
 *       attempt ALLOW (re-permit after deletion, R5.6).
 *
 * Strategy:
 * - The enforcement decision under test is the pure `decideNumericLimit` (the
 *   same function the transactional `assertWithinNumericLimit` delegates to), so
 *   this stateful sequence test exercises the exact production decision rule
 *   against an independent counting model (the oracle).
 * - The real-database transactional/concurrency guarantee for R1.6 is covered
 *   separately by the real-DB integration test (task 12.1); here we model the
 *   committed usage that those atomic transactions produce.
 */

const service = new PlanLimitsService({} as unknown as PrismaService);

const PLANS: PlanType[] = Object.values(PlanType);
const NUMERIC_RESOURCES: NumericResource[] = ['services', 'counters', 'staff', 'queuePerDay'];

const NUM_RUNS = 200;

type OpKind = 'create' | 'delete';

/** Plan/resource pairs whose resolved limit is a concrete number (bounded). */
const boundedPlanResource = (): fc.Arbitrary<[PlanType, NumericResource]> =>
  fc
    .tuple(fc.constantFrom(...PLANS), fc.constantFrom(...NUMERIC_RESOURCES))
    .filter(([p, r]) => service.numericLimitFor(p, r).limit !== null);

const operations = (): fc.Arbitrary<OpKind[]> =>
  fc.array(fc.constantFrom<OpKind>('create', 'delete'), { minLength: 1, maxLength: 60 });

/**
 * Apply a create attempt to the model using the production decision rule.
 * Mirrors `assertWithinNumericLimit`: ALLOW increments committed usage by one;
 * REJECT carries `PLAN_LIMIT_EXCEEDED` and leaves usage unchanged.
 */
function attemptCreate(
  limit: number,
  usage: number,
): { allowed: boolean; usage: number; code?: string } {
  const decision = decideNumericLimit(limit, usage);
  if (decision.allow) {
    return { allowed: true, usage: usage + 1 };
  }
  return { allowed: false, usage, code: decision.code };
}

describe('Property 2: Usage never exceeds the limit and rejects leave usage unchanged', () => {
  it('keeps committed usage within the limit; rejects are PLAN_LIMIT_EXCEEDED and no-op; below-limit creates ALLOW', () => {
    fc.assert(
      fc.property(
        boundedPlanResource(),
        fc.nat({ max: 50 }),
        operations(),
        ([plan, resource], initialUsage, opKinds) => {
          const numericLimit = service.numericLimitFor(plan, resource).limit as number;

          // Start within [0, limit]; the model never begins above the limit here
          // (grandfathered-over-limit start is exercised explicitly below).
          let usage = Math.min(initialUsage, numericLimit);
          expect(usage).toBeLessThanOrEqual(numericLimit);

          for (const kind of opKinds) {
            if (kind === 'create') {
              const before = usage;
              const wasBelowLimit = usage < numericLimit;
              const result = attemptCreate(numericLimit, usage);

              if (wasBelowLimit) {
                // (C) a create below the limit is always permitted.
                expect(result.allowed).toBe(true);
              } else {
                // (B) at/over the limit: rejected, coded, and usage unchanged.
                expect(result.allowed).toBe(false);
                expect(result.code).toBe(ERROR_CODES.PLAN_LIMIT_EXCEEDED);
                expect(result.usage).toBe(before);
              }
              usage = result.usage;

              // (A) committed usage never exceeds the limit.
              expect(usage).toBeLessThanOrEqual(numericLimit);
            } else {
              // A deletion reduces usage by one (never below zero).
              usage = Math.max(0, usage - 1);
            }
          }
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  it('re-permits the next create after a deletion drops usage below the limit (R5.6)', () => {
    const boundedPositive = (): fc.Arbitrary<[PlanType, NumericResource]> =>
      boundedPlanResource().filter(([p, r]) => (service.numericLimitFor(p, r).limit as number) > 0);

    fc.assert(
      fc.property(boundedPositive(), ([plan, resource]) => {
        const numericLimit = service.numericLimitFor(plan, resource).limit as number;

        // At the limit: the next create is rejected and leaves usage unchanged.
        let usage = numericLimit;
        const atLimit = attemptCreate(numericLimit, usage);
        expect(atLimit.allowed).toBe(false);
        expect(atLimit.code).toBe(ERROR_CODES.PLAN_LIMIT_EXCEEDED);
        expect(atLimit.usage).toBe(numericLimit);

        // Delete one instance ⇒ usage drops below the limit.
        usage = usage - 1;
        expect(usage).toBeLessThan(numericLimit);

        // The very next create is now permitted.
        const afterDelete = attemptCreate(numericLimit, usage);
        expect(afterDelete.allowed).toBe(true);
        expect(afterDelete.usage).toBe(numericLimit);
      }),
      { numRuns: NUM_RUNS },
    );
  });
});
