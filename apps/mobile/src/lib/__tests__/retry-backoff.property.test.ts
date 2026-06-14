// Feature: customer-mobile-app, Property 9: Connect-and-resubscribe retry schedule is bounded with exponential backoff
//
// Validates: Requirements 4.5
//
// For any attempt index `n` and any valid retry policy (`base > 0`, `factor >= 1`,
// `cap >= base`, `maxAttempts >= 1`):
//   - `retryDelay(n, { base, factor, cap })` returns a finite, non-negative number
//     that never exceeds `cap`;
//   - for representative (non-overflowing) values the delay equals
//     `min(base * factor^n, cap)`;
//   - the schedule is monotonically non-decreasing in `n`
//     (`retryDelay(n + 1) >= retryDelay(n)`);
//   - negative / fractional / non-finite attempt inputs are handled per the
//     implementation (floored to 0, non-finite → 0, overflow → clamp to `cap`);
//   - `canRetry(attemptsMade, maxAttempts)` is `true` iff `attemptsMade < maxAttempts`,
//     so the number of connect-and-resubscribe attempts never exceeds the bound.
//
// The retry helpers are pure and socket-free (they import nothing native), so no
// `vi.mock` stubs are needed — the test drives them directly and checks them
// against independent oracles recomputed from first principles.
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { canRetry, DEFAULT_RETRY_POLICY, retryDelay } from '@/lib/socket-registry';

/** Minimum fast-check iterations per property (design requires >= 100). */
const NUM_RUNS = 100;

// --- generators --------------------------------------------------------------

/**
 * A valid retry policy schedule portion. Bounds are kept modest so
 * `base * factor^n` does not overflow to Infinity for the small attempt indices
 * the "equals min(base * factor^n, cap)" property checks; the separate
 * overflow/edge-case properties exercise the extremes deliberately.
 */
const policyArb = (): fc.Arbitrary<{ base: number; factor: number; cap: number }> =>
  fc
    .record({
      base: fc.double({ min: 1, max: 5_000, noNaN: true, noDefaultInfinity: true }),
      factor: fc.double({ min: 1, max: 4, noNaN: true, noDefaultInfinity: true }),
      capExtra: fc.double({ min: 0, max: 1_000_000, noNaN: true, noDefaultInfinity: true }),
    })
    .map(({ base, factor, capExtra }) => ({ base, factor, cap: base + capExtra }));

/** Small, non-overflowing attempt index for the exact-formula property. */
const smallAttemptArb = (): fc.Arbitrary<number> => fc.integer({ min: 0, max: 12 });

/** Arbitrary 0-based attempt index (wider range; may saturate to `cap`). */
const attemptArb = (): fc.Arbitrary<number> => fc.integer({ min: 0, max: 2_000 });

/** Pathological attempt inputs the implementation must tolerate. */
const weirdAttemptArb = (): fc.Arbitrary<number> =>
  fc.oneof(
    fc.integer({ min: -1_000, max: -1 }), // negative → floored to 0
    fc.double({ min: -50, max: 50, noNaN: true, noDefaultInfinity: true }), // fractional
    fc.constantFrom(Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY),
    fc.integer({ min: 1_000, max: 100_000 }), // huge → overflow path
  );

// --- properties --------------------------------------------------------------

describe('Property 9: connect-and-resubscribe retry schedule is bounded with exponential backoff', () => {
  it('retryDelay is always finite, non-negative, and clamped to cap for any attempt and policy', () => {
    fc.assert(
      fc.property(policyArb(), attemptArb(), (policy, attempt) => {
        const delay = retryDelay(attempt, policy);
        expect(Number.isFinite(delay)).toBe(true);
        expect(delay).toBeGreaterThanOrEqual(0);
        expect(delay).toBeLessThanOrEqual(policy.cap);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('retryDelay equals min(base * factor^n, cap) for representative (non-overflowing) values', () => {
    fc.assert(
      fc.property(policyArb(), smallAttemptArb(), (policy, attempt) => {
        const expected = Math.min(policy.base * policy.factor ** attempt, policy.cap);
        expect(retryDelay(attempt, policy)).toBeCloseTo(expected, 6);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('retryDelay is monotonically non-decreasing in the attempt index (delay(n+1) >= delay(n))', () => {
    fc.assert(
      fc.property(policyArb(), attemptArb(), (policy, attempt) => {
        const current = retryDelay(attempt, policy);
        const next = retryDelay(attempt + 1, policy);
        // factor >= 1 → the unclamped schedule is non-decreasing, and clamping to a
        // fixed cap preserves that ordering.
        expect(next).toBeGreaterThanOrEqual(current);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('handles negative / fractional / non-finite / overflowing attempt inputs per the implementation', () => {
    fc.assert(
      fc.property(policyArb(), weirdAttemptArb(), (policy, attempt) => {
        const delay = retryDelay(attempt, policy);

        // Always within the safe envelope regardless of input shape.
        expect(Number.isFinite(delay)).toBe(true);
        expect(delay).toBeGreaterThanOrEqual(0);
        expect(delay).toBeLessThanOrEqual(policy.cap);

        // Mirror the implementation's normalization to assert exact behavior:
        // non-finite → 0, otherwise floor and clamp at 0.
        const safeAttempt = Number.isFinite(attempt) ? Math.max(0, Math.floor(attempt)) : 0;
        const raw = policy.base * policy.factor ** safeAttempt;
        const expected = Number.isFinite(raw) ? Math.min(Math.max(0, raw), policy.cap) : policy.cap;
        expect(delay).toBeCloseTo(expected, 6);

        // Inputs that floor to attempt 0 must yield min(base, cap) (the first delay).
        if (safeAttempt === 0) {
          expect(delay).toBeCloseTo(Math.min(policy.base, policy.cap), 6);
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('canRetry(attemptsMade, maxAttempts) is true iff attemptsMade < maxAttempts', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 50 }),
        fc.integer({ min: 1, max: 20 }),
        (attemptsMade, maxAttempts) => {
          expect(canRetry(attemptsMade, maxAttempts)).toBe(attemptsMade < maxAttempts);
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  it('the bounded retry loop never makes more attempts than maxAttempts', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 20 }), (maxAttempts) => {
        // Simulate an always-failing connect-and-resubscribe loop: keep retrying
        // while `canRetry` permits, counting attempts. The count must settle at
        // exactly `maxAttempts` (never exceeding the configured bound).
        let attemptsMade = 0;
        while (canRetry(attemptsMade, maxAttempts)) {
          attemptsMade += 1;
        }
        expect(attemptsMade).toBe(maxAttempts);
        expect(attemptsMade).toBeLessThanOrEqual(maxAttempts);
        expect(canRetry(attemptsMade, maxAttempts)).toBe(false);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('the DEFAULT_RETRY_POLICY satisfies the schedule invariants across its full attempt range', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: DEFAULT_RETRY_POLICY.maxAttempts + 5 }), (attempt) => {
        const delay = retryDelay(attempt, DEFAULT_RETRY_POLICY);
        expect(Number.isFinite(delay)).toBe(true);
        expect(delay).toBeGreaterThanOrEqual(0);
        expect(delay).toBeLessThanOrEqual(DEFAULT_RETRY_POLICY.cap);
        // First retry uses the base delay; later attempts never regress.
        expect(retryDelay(attempt + 1, DEFAULT_RETRY_POLICY)).toBeGreaterThanOrEqual(delay);
      }),
      { numRuns: NUM_RUNS },
    );
  });
});
