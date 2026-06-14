// Feature: plan-limit-enforcement, Property 10: Usage formatting renders the limit or "Unlimited"

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { UNLIMITED_LABEL, formatUsage } from '../lib/format-usage';

/**
 * Property 10 — Usage formatting renders the limit or "Unlimited".
 * Validates: Requirements 8.2, 8.3
 *
 * For any non-negative `usage` and any `limit`:
 *   - when `limit` is a number, `formatUsage` returns exactly `"{usage} / {limit}"`;
 *   - when `limit` is `null`, it returns exactly the unlimited label ("Unlimited").
 *
 * The expected strings are built independently of the implementation (template
 * literal + the pinned `UNLIMITED_LABEL`) so the test asserts the contract
 * rather than mirroring the function body.
 */

const RUNS = 200;

/** Non-negative usage counts (the only values a real projection produces). */
const usageArb = (): fc.Arbitrary<number> => fc.nat();

/** Non-negative numeric limits. */
const numericLimitArb = (): fc.Arbitrary<number> => fc.nat();

describe('Property 10: usage formatting renders the limit or "Unlimited"', () => {
  it('pins the unlimited label to "Unlimited" (R8.3)', () => {
    expect(UNLIMITED_LABEL).toBe('Unlimited');
  });

  it('returns "{usage} / {limit}" for any numeric limit (R8.2)', () => {
    fc.assert(
      fc.property(usageArb(), numericLimitArb(), (usage, limit) => {
        expect(formatUsage(usage, limit)).toBe(`${usage} / ${limit}`);
      }),
      { numRuns: RUNS },
    );
  });

  it('returns the unlimited label for a null limit regardless of usage (R8.3)', () => {
    fc.assert(
      fc.property(usageArb(), (usage) => {
        expect(formatUsage(usage, null)).toBe('Unlimited');
      }),
      { numRuns: RUNS },
    );
  });

  it('uses the supplied unlimited label override for a null limit (i18n), and ignores it for numeric limits', () => {
    fc.assert(
      fc.property(usageArb(), fc.option(numericLimitArb(), { nil: null }), (usage, limit) => {
        const customLabel = 'Tidak terhad';
        const result = formatUsage(usage, limit, customLabel);
        if (limit === null) {
          expect(result).toBe(customLabel);
        } else {
          expect(result).toBe(`${usage} / ${limit}`);
        }
      }),
      { numRuns: RUNS },
    );
  });
});
