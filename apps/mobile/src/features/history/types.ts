/**
 * Ticket history feature types (R7).
 *
 * These compose the shared domain types from `@queuenow/shared-types`
 * (`IQueueTicket`, `TicketStatus`); the app NEVER redefines shared domain types
 * (R10.5, R14.5). `TicketHistoryEntry` mirrors the exact shape returned by
 * `GET /customers/history`: each `QueueTicket` row is augmented with the nested
 * `service`/`organization` projections the backend includes (see
 * `customer.service.ts#getHistory`), ordered most-recent-first.
 */
import type { IQueueTicket, TicketStatus } from '@queuenow/shared-types';

/**
 * One entry from `GET /customers/history`. The backend returns each
 * {@link IQueueTicket} with a narrowed nested `service` and `organization`
 * (id + name only), ordered by `createdAt` descending. The app references those
 * entities by value rather than redefining them.
 */
export interface TicketHistoryEntry extends IQueueTicket {
  /** The service the ticket belonged to (id + display name). */
  service: { id: string; name: string };
  /** The organization the ticket belonged to (id + display name). */
  organization: { id: string; name: string };
}

/**
 * The flattened, display-ready projection of a {@link TicketHistoryEntry} (R7.2).
 * Produced by the pure {@link toHistoryRow} selector so the required row fields —
 * organization name, service name, `ticketNumber`, and the `TicketStatus` — can
 * be asserted directly (Property 13, task 12.3). `createdAt` is retained so the
 * reverse-chronological ordering (Property 12, task 12.2) is verifiable on the
 * projected rows too.
 */
export interface HistoryRow {
  /** The ticket id (stable list key). */
  id: string;
  /** The organization's display name (R7.2). */
  organizationName: string;
  /** The service's display name (R7.2). */
  serviceName: string;
  /** The issued ticket number, e.g. `A001` (R7.2). */
  ticketNumber: string;
  /** The ticket's status (R7.2). */
  status: TicketStatus;
  /** ISO-8601 creation timestamp, retained to verify ordering (R7.3). */
  createdAt: string;
}
