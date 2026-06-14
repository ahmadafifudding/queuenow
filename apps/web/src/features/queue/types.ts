/*
 * App-local types for the queue-serving panel.
 *
 * These mirror the shape returned by the backend `GET /organizations/:orgId/
 * queue/status` endpoint (apps/api `QueueService.getCurrentStatus`). The queue
 * status endpoint returns an aggregate, computed object that is not (yet)
 * described by a backend DTO, so it is not present in the generated
 * `schema.d.ts`; we therefore type it explicitly here against the observed
 * response. Domain enums/interfaces still come from `@queuenow/shared-types`
 * where they apply.
 *
 * Assumption (documented for task 8.1): the status payload exposes a per-service
 * `serving` COUNT rather than the specific ticket a given staff member is
 * serving. The concrete "ticket I am serving" surfaces via the serving mutation
 * hooks (task 8.2). Until then the panel renders the serving count.
 */

/** A single currently-called ticket as summarized by the status endpoint. */
export interface CalledTicketSummary {
  /** Human-facing ticket number, e.g. `A012`. */
  ticketNumber: string;
  /** The counter the ticket was called to, when assigned. */
  counterName?: string;
}

/** Per-service queue snapshot within the status response. */
export interface QueueServiceStatus {
  /** The service this snapshot is for. */
  service: {
    id: string;
    name: string;
    prefix: string;
  };
  /** Count of tickets still WAITING today. */
  waiting: number;
  /** The most recently CALLED tickets (with their counters). */
  currentlyCalled: CalledTicketSummary[];
  /** Count of tickets currently being SERVED. */
  serving: number;
  /** Count of tickets COMPLETED today. */
  completedToday: number;
  /** Estimated wait for a new joiner, in minutes (`waiting * avgServingTime`). */
  estimatedWaitMinutes: number;
}

/** Full queue-status payload for an organization. */
export interface QueueStatusResponse {
  /** The organization the status belongs to. */
  organizationId: string;
  /** Display name of the organization. */
  organizationName: string;
  /** One snapshot per active service (optionally filtered to one service). */
  services: QueueServiceStatus[];
  /** ISO-8601 timestamp of when the status was computed. */
  lastUpdated: string;
}
