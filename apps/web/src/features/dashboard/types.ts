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

/** A currently-called ticket shown in the dashboard "now calling" strip. */
export interface OverviewCalledTicket {
  ticketNumber: string;
  counterName?: string;
}

/** Per-service queue snapshot for the dashboard breakdown. */
export interface OverviewServiceStatus {
  service: { id: string; name: string; prefix: string };
  waiting: number;
  serving: number;
  completedToday: number;
  currentlyCalled: OverviewCalledTicket[];
}

/** The dashboard's live queue overview (subset of the public queue-status read). */
export interface QueueOverview {
  organizationId: string;
  organizationName: string;
  services: OverviewServiceStatus[];
  lastUpdated: string;
}
