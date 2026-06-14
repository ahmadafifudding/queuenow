// Feature: customer-mobile-app, Property 12: Reverse-chronological ordering.
// For any list of createdAt-bearing items (the persisted notifications list or
// the ticket-history list), the displayed order is non-increasing by createdAt
// — most recent first.
//
// Validates: Requirements 5.7, 7.3
//
// Both helpers under test are PURE, side-effect-free sorts over items carrying
// an ISO-8601 `createdAt`:
//   - `sortHistoryDescending` (features/history/history-projection.ts) — R7.3
//   - `orderByMostRecent`      (features/notifications/order-notifications.ts) — R5.7
// Neither imports an expo-* native module (history pulls in only erased TYPE
// imports; notifications imports nothing), so this property needs none of the
// `vi.mock` native stubs the client tests use.
//
// Property 12 spans BOTH lists, so this file exercises both helpers against the
// same generated input space and asserts the same two invariants on each:
//   (a) the output is a permutation of the input (nothing added/dropped/mutated)
//   (b) the output is non-increasing by parsed `createdAt` epoch
//
// Both implementations parse with `Date.parse` and map unparseable values to
// `Number.NEGATIVE_INFINITY` (sorted last). The oracle below mirrors that
// exactly so "unparseable sorts last" is asserted as a real, intended behavior
// rather than left undefined. The generator therefore deliberately mixes:
//   - valid ISO timestamps across a wide range,
//   - a small pool of repeated timestamps to force equal-key ties/duplicates,
//   - explicitly unparseable strings ('', 'not-a-date', …),
// so every run probes the recent/old boundary, ties, and the unparseable tail.
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { orderByMostRecent } from '@/features/notifications/order-notifications';
import { sortHistoryDescending } from '@/features/history/history-projection';

/**
 * The oracle for display priority, identical to both helpers' internal
 * `toEpoch`: a parseable ISO timestamp maps to its epoch millis; anything that
 * does not parse to a finite instant maps to `-Infinity` so it sorts last.
 */
function toEpoch(createdAt: string): number {
  const ms = Date.parse(createdAt);
  return Number.isNaN(ms) ? Number.NEGATIVE_INFINITY : ms;
}

/** A generated item: a unique `tag` (for permutation checks) + an ISO-ish `createdAt`. */
interface Item {
  /** Unique within an array so the output multiset can be matched to the input. */
  tag: number;
  /** The value the helpers order by — may be valid ISO or deliberately unparseable. */
  createdAt: string;
}

/**
 * A small pool of fixed timestamps so the generator produces frequent ties and
 * exact duplicates, exercising the stable-order-on-equal-keys path.
 */
const REPEATED_TIMESTAMPS: readonly string[] = [
  '2024-01-01T00:00:00.000Z',
  '2024-06-15T12:30:00.000Z',
  '2024-06-15T12:30:00.000Z', // duplicate of the above, on purpose
  '2025-12-31T23:59:59.999Z',
] as const;

/** Strings that `Date.parse` cannot turn into a finite instant — must sort last. */
const UNPARSEABLE: readonly string[] = [
  '',
  'not-a-date',
  'tomorrow',
  '2024-13-45T99:99:99Z',
] as const;

/**
 * A `createdAt` value spanning the full input space: broad valid ISO timestamps,
 * a repeated-timestamp pool (ties/duplicates), and unparseable strings (tail).
 */
const createdAtArb: fc.Arbitrary<string> = fc.oneof(
  // Wide range of valid ISO timestamps (well within JS Date's safe range).
  fc
    .date({ min: new Date('1970-01-01T00:00:00.000Z'), max: new Date('2100-01-01T00:00:00.000Z') })
    .map((d) => d.toISOString()),
  // Repeated fixed timestamps to force equal keys and exact duplicates.
  fc.constantFrom(...REPEATED_TIMESTAMPS),
  // Unparseable values that must end up last.
  fc.constantFrom(...UNPARSEABLE),
);

/**
 * An array of items with unique `tag`s (so a permutation check is well-defined)
 * and arbitrary `createdAt` values, including the empty list and large lists.
 */
const itemsArb: fc.Arbitrary<Item[]> = fc
  .array(createdAtArb, { maxLength: 40 })
  .map((createdAts) => createdAts.map((createdAt, index) => ({ tag: index, createdAt })));

/** Assert `output` is a permutation of `input`: same length and same item multiset by `tag`. */
function expectPermutation(input: readonly Item[], output: readonly Item[]): void {
  expect(output).toHaveLength(input.length);
  const byTag = (a: Item, b: Item): number => a.tag - b.tag;
  // Sorting both by the stable unique tag and deep-comparing proves no item was
  // added, dropped, duplicated, or mutated — only reordered.
  expect([...output].sort(byTag)).toEqual([...input].sort(byTag));
}

/** Assert `output` is ordered non-increasing by parsed `createdAt` epoch (most recent first). */
function expectNonIncreasing(output: readonly Item[]): void {
  for (let i = 1; i < output.length; i += 1) {
    const prev = output[i - 1];
    const curr = output[i];
    if (!prev || !curr) {
      throw new Error('unexpected undefined item while checking ordering');
    }
    expect(toEpoch(prev.createdAt)).toBeGreaterThanOrEqual(toEpoch(curr.createdAt));
  }
}

describe('Property 12: Reverse-chronological ordering', () => {
  it('sortHistoryDescending (history list, R7.3) orders most-recent-first and preserves the items', () => {
    fc.assert(
      fc.property(itemsArb, (items) => {
        const output = sortHistoryDescending(items);

        // (a) The displayed list is a permutation of the source list.
        expectPermutation(items, output);
        // (b) The displayed order is non-increasing by createdAt.
        expectNonIncreasing(output);
        // The helper is non-mutating: the input array order is untouched.
        expect(items.map((i) => i.tag)).toEqual(items.map((_, idx) => idx));
      }),
      { numRuns: 100 },
    );
  });

  it('orderByMostRecent (notifications list, R5.7) orders most-recent-first and preserves the items', () => {
    fc.assert(
      fc.property(itemsArb, (items) => {
        const output = orderByMostRecent(items);

        // (a) The displayed list is a permutation of the source list.
        expectPermutation(items, output);
        // (b) The displayed order is non-increasing by createdAt.
        expectNonIncreasing(output);
        // The helper is non-mutating: the input array order is untouched.
        expect(items.map((i) => i.tag)).toEqual(items.map((_, idx) => idx));
      }),
      { numRuns: 100 },
    );
  });

  it('both helpers agree on the displayed order for the same input', () => {
    fc.assert(
      fc.property(itemsArb, (items) => {
        // Property 12 covers both lists with one ordering rule; for identical
        // input the two pure sorts must produce the same reverse-chronological
        // sequence of tags.
        const fromHistory = sortHistoryDescending(items).map((i) => i.tag);
        const fromNotifications = orderByMostRecent(items).map((i) => i.tag);
        expect(fromHistory).toEqual(fromNotifications);
      }),
      { numRuns: 100 },
    );
  });
});
