/**
 * Pure favorites selectors (R8.2, R8.3).
 *
 * Kept free of React / network so they can be unit-tested directly in the
 * headless `node` test environment and reused by both the {@link FavoriteToggle}
 * and the {@link FavoritesList} without duplicating the "is this org already a
 * favorite" rule.
 */
import type { FavoriteItem } from './types';

/**
 * Whether `orgId` is present in the customer's favorites list.
 *
 * Matches on the favorite's `orgId` (the canonical organization id the
 * add/remove endpoints are keyed on), so the result is stable even when a
 * favorite's joined organization details are absent (an inactive org resolves
 * `organization` to `undefined`, R8.4).
 *
 * @param items The favorites list (e.g. `useFavorites().data`); `undefined`
 *   while the query has not resolved.
 * @param orgId The organization id to test.
 * @returns `true` iff a favorite with the given `orgId` exists.
 */
export function isOrgFavorited(items: FavoriteItem[] | undefined, orgId: string): boolean {
  if (!items || orgId === '') {
    return false;
  }
  return items.some((item) => item.orgId === orgId);
}
