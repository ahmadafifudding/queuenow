/**
 * App-local view models (composition only) — Data Models section of the design.
 *
 * These types are COMPOSITIONS of the shared domain types exported by
 * `@queuenow/shared-types`. The app never redefines queue/ticket/organization
 * types (R10.5, R14.5); it only augments them with the backend's response-shape
 * additions (e.g. backend-computed `position`/`estimatedWaitMinutes`, the
 * assigned counter on `CALLED`) and with purely client-side wrappers such as the
 * offline cache record.
 *
 * Only the view models required by the offline cache (task 5.2) are defined
 * here. Other view models named in the design (`DiscoveryTarget`,
 * `JoinedTicket`, `NotificationListItem`) are introduced by their owning
 * feature tasks.
 */
import type { IQueueTicket } from '@queuenow/shared-types';

/**
 * Projection of the ticket-status response
 * (`GET /organizations/:orgId/queue/ticket/:ticketId`).
 *
 * Extends the shared {@link IQueueTicket} with the backend-computed live fields.
 * `position`/`estimatedWaitMinutes` are `null` for terminal states
 * (`COMPLETED`/`SKIPPED`) where no live queue information exists (R3.5); the
 * assigned `counter` is present when the ticket is `CALLED` (R3.4). These values
 * are surfaced verbatim from the backend — the app applies no client-side offset
 * (R2.4).
 */
export interface TicketStatusView extends IQueueTicket {
  /** People ahead in line; `null` for terminal states. Backend-computed (R2.4). */
  position: number | null;
  /** Estimated wait in minutes; `null` for terminal states. Backend-computed. */
  estimatedWaitMinutes: number | null;
  /** Assigned counter, present when `status` is `CALLED` (R3.4). */
  counter?: { id: string; name: string } | null;
  /** The service the ticket belongs to, when included by the backend. */
  service?: { id: string; name: string; prefix: string; avgServingTime: number };
}

/**
 * Read-only offline cache record for the Active_Ticket (R9.1, R9.2).
 *
 * Persisted to device storage on every successful Active_Ticket load so the
 * tracking screen can render last-known details while offline. `cachedAt` is an
 * ISO-8601 timestamp that drives the "may be out of date" staleness indicator.
 * This record is strictly read-only — the app never mutates server state from
 * the cache.
 */
export interface CachedActiveTicket {
  /** Organization that owns the cached ticket. */
  orgId: string;
  /** The last-known ticket-status projection. */
  ticket: TicketStatusView;
  /** ISO-8601 timestamp of when the record was cached (drives staleness, R9.2). */
  cachedAt: string;
}
