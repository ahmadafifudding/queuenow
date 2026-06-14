/*
 * Public REST paths used by the Display board.
 *
 * The Display is PUBLIC and read-only (R7.1): it reads the org's queue status
 * from the backend's `@Public()` endpoint and never calls a mutating route.
 * Path is relative to `env.VITE_API_URL` — the API_Client prefixes the base URL
 * (and origin/`/api/v1`), so this never includes them.
 */
export const displayEndpoints = {
  /**
   * GET the current queue status for an org (public, no auth). Returns the
   * per-service waiting counts plus the currently CALLED tickets with their
   * counter names — exactly what the board renders (R7.2).
   */
  status: (orgId: string): string => `/organizations/${orgId}/queue/status`,
} as const;
