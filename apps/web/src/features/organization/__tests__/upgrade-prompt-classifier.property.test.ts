// Feature: plan-limit-enforcement, Property 12: Upgrade prompt is triggered exactly by PLAN_LIMIT_EXCEEDED
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { ERROR_CODES } from '@queuenow/shared-constants';

import { ApiError } from '@/lib/api/client';
import { isPlanLimitExceeded, onPlanLimitError } from '../lib/plan-limit-error';

/**
 * Property 12 — Validates: Requirements 8.5
 *
 * The upgrade-prompt classifier `isPlanLimitExceeded` must return `true` if and
 * ONLY if the error carries `code === 'PLAN_LIMIT_EXCEEDED'`. Equivalently, the
 * shared `onPlanLimitError` handler invokes the upgrade prompt (and signals
 * "retain the form") exactly for those errors and for no others.
 *
 * The generator spans the realistic shapes a call site can throw: typed
 * `ApiError`s across every backend code, plain `{ code }` objects, plain
 * `Error`s (no code), and non-object/nullish values. The oracle is computed
 * independently of the implementation: `true` iff the value is an object with a
 * `code` property strictly equal to the plan-limit code.
 */

/** Every backend error code, used to exercise non-matching codes too. */
const ALL_CODES = Object.values(ERROR_CODES);

/** Oracle: true iff value is an object whose `code` equals the plan-limit code. */
function oracleIsPlanLimit(value: unknown): boolean {
  return (
    typeof value === 'object' &&
    value !== null &&
    'code' in value &&
    (value as { code?: unknown }).code === ERROR_CODES.PLAN_LIMIT_EXCEEDED
  );
}

/** Arbitrary error code: any real backend code, or a random/unknown string. */
const codeArb: fc.Arbitrary<string> = fc.oneof(fc.constantFrom(...ALL_CODES), fc.string());

/**
 * Candidate errors a mutation `onError` could receive:
 *  - a typed `ApiError` with some code (the common case),
 *  - a plain object carrying a `code` (structural match path),
 *  - a plain `Error` with no `code` (must never match),
 *  - non-object primitives / nullish (must never match).
 */
const errorArb: fc.Arbitrary<unknown> = fc.oneof(
  codeArb.map((code) => new ApiError(code, `message for ${code}`)),
  codeArb.map((code) => ({ code })),
  fc.string().map((m) => new Error(m)),
  fc.constantFrom(null, undefined, 0, 'PLAN_LIMIT_EXCEEDED', 42, true, {}),
);

describe('Property 12: upgrade prompt is triggered exactly by PLAN_LIMIT_EXCEEDED', () => {
  it('isPlanLimitExceeded returns true iff code === PLAN_LIMIT_EXCEEDED', () => {
    fc.assert(
      fc.property(errorArb, (error) => {
        expect(isPlanLimitExceeded(error)).toBe(oracleIsPlanLimit(error));
      }),
      { numRuns: 200 },
    );
  });

  it('onPlanLimitError invokes the prompt and returns true exactly for plan-limit errors', () => {
    fc.assert(
      fc.property(errorArb, (error) => {
        let calls = 0;
        let received: unknown = Symbol('unset');
        const handled = onPlanLimitError(error, (e) => {
          calls += 1;
          received = e;
        });

        const expected = oracleIsPlanLimit(error);
        // Return value (the "do not reset the form" signal) matches the oracle.
        expect(handled).toBe(expected);
        // The prompt fires exactly once for matches, never otherwise.
        expect(calls).toBe(expected ? 1 : 0);
        if (expected) {
          // The originating error is forwarded to the presenter unchanged.
          expect(received).toBe(error);
        }
      }),
      { numRuns: 200 },
    );
  });
});
