/**
 * PURE ticket-status projection (R3.1, R3.4, R3.5; design Property 5).
 *
 * {@link projectTicketStatus} maps the ticket-status response
 * (`GET /organizations/:orgId/queue/ticket/:ticketId`, modeled as
 * {@link TicketStatusView}) into the narrow view the tracking screen renders.
 * The projection ENFORCES the status-dependent invariants regardless of what
 * the backend sends, so the rules hold by construction:
 *
 *  - live `position` / `estimatedWaitMinutes` are exposed ONLY when the ticket is
 *    `WAITING` (R3.1) — they are nulled for every other status, so a stale
 *    backend value can never leak into a `CALLED`/terminal view;
 *  - the assigned `counterName` is exposed when the ticket is `CALLED` (R3.4)
 *    (and, for continuity, while `SERVING`) and a counter is actually assigned;
 *  - `isTerminal` is set for `COMPLETED` / `SKIPPED`, where there is no live
 *    queue position to present (R3.5).
 *
 * Values are surfaced VERBATIM from the backend — no client-side arithmetic is
 * applied to `position` / `estimatedWaitMinutes` (R2.4). The function is pure and
 * side-effect free (no I/O, no `Date`, no randomness), so it is exercised
 * directly by its property test (task 9.2, Property 5).
 */
import { TicketStatus } from '@queuenow/shared-types';

import type { TicketStatusView } from '@/lib/view-models';

/**
 * The projected, render-ready ticket status consumed by the tracking screen.
 *
 * Each field is already gated by status, so the UI can render it directly
 * without re-deriving the WAITING/CALLED/terminal rules.
 */
export interface ProjectedTicketStatus {
  /** The current ticket status (verbatim from the backend). */
  status: TicketStatus;
  /** The issued ticket number (e.g. `A001`). */
  ticketNumber: string;
  /** `true` for terminal states (`COMPLETED` / `SKIPPED`) with no live tracking (R3.5). */
  isTerminal: boolean;
  /** People ahead in line; non-null ONLY when `WAITING` (R3.1), else `null`. */
  position: number | null;
  /** Estimated wait in minutes; non-null ONLY when `WAITING` (R3.1), else `null`. */
  estimatedWaitMinutes: number | null;
  /** Assigned counter name; present when `CALLED`/`SERVING` and a counter exists (R3.4). */
  counterName: string | null;
  /** The service the ticket belongs to, when the backend included it. */
  service?: TicketStatusView['service'];
}

/**
 * Project a ticket-status response into the render-ready {@link ProjectedTicketStatus}.
 *
 * Pure: the same input always yields the same output, with no side effects. The
 * status-dependent invariants (R3.1/R3.4/R3.5) are enforced here so callers and
 * the property test (task 9.2) can rely on them holding for ANY input.
 *
 * @param ticket The ticket-status response projection.
 * @returns The gated, render-ready status view.
 */
export function projectTicketStatus(ticket: TicketStatusView): ProjectedTicketStatus {
  const isWaiting = ticket.status === TicketStatus.WAITING;
  const isCalled = ticket.status === TicketStatus.CALLED;
  const isServing = ticket.status === TicketStatus.SERVING;
  const isTerminal =
    ticket.status === TicketStatus.COMPLETED || ticket.status === TicketStatus.SKIPPED;

  return {
    status: ticket.status,
    ticketNumber: ticket.ticketNumber,
    isTerminal,
    // Live queue figures are meaningful only while WAITING (R3.1); for every
    // other status (including terminal, R3.5) they are suppressed to `null`.
    position: isWaiting ? (ticket.position ?? null) : null,
    estimatedWaitMinutes: isWaiting ? (ticket.estimatedWaitMinutes ?? null) : null,
    // The counter is named once the ticket is CALLED (R3.4) and remains while
    // SERVING; it is null otherwise or when no counter has been assigned yet.
    counterName: (isCalled || isServing) && ticket.counter ? ticket.counter.name : null,
    service: ticket.service,
  };
}
