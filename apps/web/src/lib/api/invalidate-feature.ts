/*
 * Feature invalidation helper (Requirements 8.5, 9.5, 10.4).
 *
 * The services (task 11), counters (task 12) and staff (task 13) CRUD mutation
 * hooks all share the same success contract: after a successful mutation, the
 * feature's list query must be invalidated so the UI reflects current data
 * (steering "API Layer" — "Mutations invalidate the relevant query keys on
 * success"). Rather than have each hook hand-write
 * `queryClient.invalidateQueries({ queryKey: queryKeys.<feature>(...) })`, those
 * hooks route through this single helper so producers (queries) and consumers
 * (mutation `onSuccess`) stay keyed off the central `queryKeys` factory and can
 * never drift.
 *
 * This helper is intentionally minimal — it only resolves the correct feature
 * key from the factory and calls `invalidateQueries`. It is the contract that
 * Property 9 pins in place before the feature hooks exist.
 */
import type { QueryClient } from '@tanstack/react-query';

import { queryKeys } from '@/lib/api/query-keys';

/**
 * Discriminated description of which feature list to invalidate after a
 * successful mutation. `staff` is page-scoped (the list is paginated); services
 * and counters are whole-org lists.
 */
export type FeatureInvalidation =
  | { readonly feature: 'services'; readonly orgId: string }
  | { readonly feature: 'counters'; readonly orgId: string }
  | { readonly feature: 'staff'; readonly orgId: string; readonly page: number };

/**
 * Resolve the central `queryKeys` array for a feature-invalidation target.
 *
 * Always goes through the {@link queryKeys} factory so the key shape matches the
 * one the corresponding query producer uses.
 */
export function featureQueryKey(target: FeatureInvalidation): readonly [string, ...unknown[]] {
  switch (target.feature) {
    case 'services':
      return queryKeys.services(target.orgId);
    case 'counters':
      return queryKeys.counters(target.orgId);
    case 'staff':
      return queryKeys.staff(target.orgId, target.page);
  }
}

/**
 * Invalidate exactly the query key(s) for a feature on a given org (and page,
 * for staff). Used by the feature mutation hooks' `onSuccess` callbacks.
 *
 * Relies on TanStack Query's default partial (prefix) key matching: invalidating
 * `['services', orgId]` matches queries cached under that key but never under a
 * different feature, a different org, or (for staff) a different page.
 *
 * @returns the promise from `invalidateQueries` so callers may await refetches.
 */
export function invalidateFeature(
  queryClient: QueryClient,
  target: FeatureInvalidation,
): Promise<void> {
  return queryClient.invalidateQueries({ queryKey: featureQueryKey(target) });
}
