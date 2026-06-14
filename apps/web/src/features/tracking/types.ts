/*
 * App-local types for the public ticket-tracking surface.
 *
 * Shapes mirror the backend's public ticket-status read
 * (`GET /organizations/:orgId/queue/ticket/:ticketId`), which returns the full
 * ticket plus its service/counter and, while WAITING, the live `position` and
 * `estimatedWaitMinutes`. We model only the fields the tracking page renders.
 */
import type { TicketStatus } from '@queuenow/shared-types';

/** The service a ticket belongs to (subset returned for tracking). */
export interface TrackedService {
  id: string;
  name: string;
  prefix: string;
}

/** The counter a ticket was called to, when assigned. */
export interface TrackedCounter {
  id: string;
  name: string;
}

/** The public tracking view of a single queue ticket. */
export interface TrackedTicket {
  /** Ticket id (the tracking key from the QR link). */
  id: string;
  /** Human-facing ticket number, e.g. `GEN012`. */
  ticketNumber: string;
  /** Lifecycle status: WAITING → CALLED → SERVING → COMPLETED/SKIPPED. */
  status: TicketStatus;
  /** How many times the ticket has been recalled. */
  recallCount: number;
  /** The service this ticket is queued for. */
  service: TrackedService;
  /** The counter the ticket was called to, or `null` if not yet called. */
  counter: TrackedCounter | null;
  /** 1-based position in line while WAITING; `null` once called/served. */
  position: number | null;
  /** Estimated wait in minutes while WAITING; `null` otherwise. */
  estimatedWaitMinutes: number | null;
}
