/*
 * Central query-key factory. Query keys are arrays namespaced by feature so
 * that invalidation stays consistent across the app (steering "API Layer", R2).
 *
 * Always go through this factory rather than hand-writing key arrays — that
 * keeps producers (queries) and consumers (mutation invalidation, the socket
 * bridge) in sync. Keys are `as const` tuples so their shape is preserved for
 * type-safe partial matching in `queryClient.invalidateQueries`.
 */
export const queryKeys = {
  /** Queue state for an org, optionally scoped to a single service. */
  queue: (orgId: string, serviceId?: string) => ['queue', orgId, serviceId] as const,
  /** The org's services list. */
  services: (orgId: string) => ['services', orgId] as const,
  /** The org's counters list. */
  counters: (orgId: string) => ['counters', orgId] as const,
  /** A single page of the org's staff list. */
  staff: (orgId: string, page: number) => ['staff', orgId, page] as const,
  /** A single queue ticket's public tracking status. */
  ticket: (orgId: string, ticketId: string) => ['ticket', orgId, ticketId] as const,
  /** Today's queue statistics for the org dashboard. */
  orgStats: (orgId: string) => ['org-stats', orgId] as const,
  /** The organization record itself. */
  org: (orgId: string) => ['organization', orgId] as const,
  /** The org's plan + per-resource usage projection (R8). */
  planUsage: (orgId: string) => ['plan-usage', orgId] as const,
  /**
   * The current user's organization memberships. Deliberately user-scoped (NOT
   * org-scoped) so the list survives an org switch and is not cleared by the
   * post-switch org-scoped cache invalidation (org-switching R5.1, R5.10).
   */
  organizations: () => ['organizations'] as const,
} as const;

export type QueryKeys = typeof queryKeys;
