/*
 * App-local types for the dashboard home summary.
 *
 * Mirrors the backend `GET /organizations/:id/stats` response, which returns
 * today's ticket counts by status.
 */

/** Today's queue statistics for an organization. */
export interface OrgStats {
  /** Tickets currently waiting today. */
  waiting: number;
  /** Tickets currently being served today. */
  serving: number;
  /** Tickets completed today. */
  completed: number;
  /** Tickets skipped today. */
  skipped: number;
  /** Total tickets issued today (waiting + serving + completed + skipped). */
  total: number;
}
