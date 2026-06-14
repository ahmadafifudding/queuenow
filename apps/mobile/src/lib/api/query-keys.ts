/*
 * Central query-key factory for the mobile app. Query keys are `as const`
 * tuples namespaced by feature so that invalidation stays consistent across the
 * app (design "TanStack Query usage & query keys", R10.1).
 *
 * Always go through this factory rather than hand-writing key arrays — that
 * keeps producers (queries) and consumers (mutation invalidation, the socket
 * bridge) in sync. Keys are `as const` tuples so their shape is preserved for
 * type-safe partial matching in `queryClient.invalidateQueries`.
 *
 * Account-scoped keys (`history`, `favorites`, `notifications`) are removed
 * from the cache on sign-out so no account data survives the session (R7.4);
 * see `lib/api/invalidation.ts`.
 */
export const queryKeys = {
  /** Org queue status, optionally scoped to a single service. */
  orgStatus: (orgId: string, serviceId?: string) => ['org-status', orgId, serviceId] as const,
  /** A single queue ticket's tracking status. */
  ticket: (orgId: string, ticketId: string) => ['ticket', orgId, ticketId] as const,
  /** The signed-in customer's ticket history (account-scoped). */
  history: () => ['customer-history'] as const,
  /** The signed-in customer's favorites (account-scoped). */
  favorites: () => ['customer-favorites'] as const,
  /** The signed-in customer's persisted notifications (account-scoped). */
  notifications: () => ['notifications'] as const,
} as const;

export type QueryKeys = typeof queryKeys;
