/*
 * App-local types for the public Display (TV) board.
 *
 * These mirror the shape returned by the backend public queue-status endpoint
 * `GET /organizations/:orgId/queue/status` (apps/api `QueueService.
 * getCurrentStatus`, marked `@Public()`). That aggregate is computed at request
 * time and is not described by a backend DTO, so it is not present in the
 * generated `schema.d.ts`; we therefore type it explicitly here against the
 * observed response.
 *
 * The Display feature keeps its own copy (rather than importing the queue
 * feature's internals) per the frontend-web rule that a feature never reaches
 * into another feature's internals — the two surfaces only share the central
 * query KEY (`queryKeys.queue`) via `lib/api/query-keys.ts`, which is what lets
 * the socket bridge and polling fallback push live updates into this read.
 */

/** A single currently-called ticket as summarized by the status endpoint. */
export interface DisplayCalledTicket {
  /** Human-facing ticket number, e.g. `A012`. */
  ticketNumber: string;
  /** The counter the ticket was called to, when one is assigned. */
  counterName?: string;
}

/** Per-service snapshot within the public status response. */
export interface DisplayServiceStatus {
  /** The service this snapshot is for. */
  service: {
    id: string;
    name: string;
    prefix: string;
  };
  /** Count of tickets still WAITING today. */
  waiting: number;
  /** The most recently CALLED tickets (with their counters), newest first. */
  currentlyCalled: DisplayCalledTicket[];
  /** Count of tickets currently being SERVED. */
  serving: number;
  /** Count of tickets COMPLETED today. */
  completedToday: number;
  /** Estimated wait for a new joiner, in minutes. */
  estimatedWaitMinutes: number;
}

/** Full public queue-status payload for an organization. */
export interface DisplayQueueStatus {
  /** The organization the status belongs to. */
  organizationId: string;
  /** Display name of the organization. */
  organizationName: string;
  /** One snapshot per active service (optionally filtered to one service). */
  services: DisplayServiceStatus[];
  /** ISO-8601 timestamp of when the status was computed. */
  lastUpdated: string;
}

/**
 * A flattened currently-called entry ready for rendering on the board: a called
 * ticket paired with the name of the service it belongs to (R7.2).
 */
export interface DisplayCalledEntry extends DisplayCalledTicket {
  /** Stable key for React lists (`serviceId::ticketNumber`). */
  key: string;
  /** The name of the service the ticket belongs to. */
  serviceName: string;
}
