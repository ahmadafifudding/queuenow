/**
 * Reverse-chronological ordering for the notifications list (R5.7).
 *
 * `GET /notifications` returns entries the app must display "in reverse
 * chronological order" — most recent first. This is a PURE, reusable helper so
 * the screen never sorts inline and the ordering is independently testable
 * (Property 12 / test 12.2 covers reverse-chronological ordering generically).
 *
 * The comparator is generic over any item carrying an ISO-8601 `createdAt`, so
 * it can be reused for other time-ordered lists if needed. Input is never
 * mutated — a new sorted array is returned.
 */

/** The minimal shape ordered by {@link orderByMostRecent}: an ISO `createdAt`. */
export interface HasCreatedAt {
  /** ISO-8601 creation timestamp. */
  createdAt: string;
}

/**
 * Return a new array ordered from most recent to least recent by `createdAt`
 * (reverse chronological, R5.7).
 *
 * Timestamps are compared as parsed epoch milliseconds. Any value that does not
 * parse to a finite instant is treated as the oldest (sorted last) and ties
 * preserve input order (modern engines provide a stable sort), so equal
 * timestamps keep a deterministic relative order.
 *
 * @param items The items to order. Not mutated.
 * @returns A new array sorted most-recent-first.
 */
export function orderByMostRecent<T extends HasCreatedAt>(items: readonly T[]): T[] {
  return [...items].sort((a, b) => toEpoch(b.createdAt) - toEpoch(a.createdAt));
}

/** Parse an ISO timestamp to epoch ms; non-finite values sort oldest (`-Infinity`). */
function toEpoch(value: string): number {
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? Number.NEGATIVE_INFINITY : ms;
}
