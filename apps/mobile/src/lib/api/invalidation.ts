import type { QueryClient } from '@tanstack/react-query';

import { queryKeys } from '@/lib/api/query-keys';

/*
 * Cache invalidation / removal helpers (design "TanStack Query usage & query
 * keys" — Invalidation rules).
 *
 * Each helper takes the `QueryClient` so it stays side-effect free and easy to
 * call from mutations, the socket bridge, the auth manager, and connectivity
 * handlers without importing the singleton directly. Keys always come from the
 * `queryKeys` factory so producers and consumers stay in sync.
 */

/**
 * Join success → invalidate the org's queue status (optionally service-scoped)
 * so counts/wait estimates reflect the new ticket.
 */
export function invalidateOrgStatusOnJoin(
  queryClient: QueryClient,
  orgId: string,
  serviceId?: string,
): Promise<void> {
  return queryClient.invalidateQueries({ queryKey: queryKeys.orgStatus(orgId, serviceId) });
}

/**
 * `ticket:update` / `ticket:notification` for the tracked ticket, or a manual /
 * connectivity-restore refresh → invalidate the ticket so REST stays the source
 * of truth (no parallel store). (R3.3, R9.3, R9.4)
 */
export function invalidateTicket(
  queryClient: QueryClient,
  orgId: string,
  ticketId: string,
): Promise<void> {
  return queryClient.invalidateQueries({ queryKey: queryKeys.ticket(orgId, ticketId) });
}

/** Add/remove favorite → invalidate the favorites list. (R8.2, R8.3) */
export function invalidateFavorites(queryClient: QueryClient): Promise<void> {
  return queryClient.invalidateQueries({ queryKey: queryKeys.favorites() });
}

/**
 * Sign-out → REMOVE account-scoped data (history, favorites, notifications)
 * from the cache so no account data (including cached history) survives the
 * session. Removal (not just invalidation) is required by R7.4.
 */
export function clearAccountScopedQueries(queryClient: QueryClient): void {
  queryClient.removeQueries({ queryKey: queryKeys.history() });
  queryClient.removeQueries({ queryKey: queryKeys.favorites() });
  queryClient.removeQueries({ queryKey: queryKeys.notifications() });
}
