// Feature: customer-mobile-app, Property 4: Position and wait are displayed
// verbatim (no client offset). For any join or ticket-status response, the
// displayed `position` equals the backend `position` and the displayed
// `estimatedWaitMinutes` equals the backend `estimatedWaitMinutes`, with no
// client-side arithmetic applied.
//
// Validates: Requirements 2.4
//
// Both projections under test are PURE and side-effect free:
//   - `toJoinedTicketDisplay` projects the join response (Property 4 / task 8.3),
//   - `projectTicketStatus` projects the ticket-status response and, while the
//     ticket is WAITING, exposes the same backend `position`/`estimatedWaitMinutes`
//     verbatim.
// This test targets the verbatim pass-through ONLY: it asserts the displayed
// numeric values are byte-for-byte identical to the backend inputs (no +1/-1, no
// scaling). The WAITING case is checked through `projectTicketStatus`; terminal
// nulling is a separate property (task 9.2, Property 5) and is intentionally out
// of scope here.
import { TicketStatus } from '@queuenow/shared-types';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { toJoinedTicketDisplay } from '@/features/queue/build-join-request';
import { projectTicketStatus } from '@/features/queue/project-ticket-status';
import type { JoinedTicket } from '@/features/queue/types';
import type { TicketStatusView } from '@/lib/view-models';

/** Minimum fast-check iterations per property (design requires ≥100). */
const NUM_RUNS = 100;

// --- arbitraries -------------------------------------------------------------

/**
 * Backend-computed `position` spanning the meaningful values the design calls
 * out: 0 (front of line / no one ahead), 1, and large counts. Restricted to
 * non-negative integers because a queue position is a count, exactly as the
 * backend computes it.
 */
const positionArb: fc.Arbitrary<number> = fc.oneof(
  fc.constant(0),
  fc.constant(1),
  fc.integer({ min: 0, max: 100_000 }),
);

/**
 * Backend-computed `estimatedWaitMinutes` — a non-negative wait in minutes,
 * including 0 and large waits. The projection must pass these through unchanged
 * (no rounding, scaling, or offset).
 */
const waitArb: fc.Arbitrary<number> = fc.oneof(
  fc.constant(0),
  fc.constant(1),
  fc.integer({ min: 0, max: 100_000 }),
);

/** A plausible issued ticket number (e.g. `A001`); irrelevant to the math. */
const ticketNumberArb: fc.Arbitrary<string> = fc
  .tuple(fc.constantFrom('A', 'B', 'C', 'Z'), fc.integer({ min: 0, max: 9999 }))
  .map(([prefix, n]) => `${prefix}${String(n).padStart(3, '0')}`);

/**
 * A join response (`JoinedTicket`): the shared `IQueueTicket` augmented with the
 * backend-computed `position`/`estimatedWaitMinutes`. Only the fields the
 * display projection reads need to vary; the rest are filled with stable, valid
 * values so the generated object is a faithful `IQueueTicket`.
 */
const joinedTicketArb: fc.Arbitrary<JoinedTicket> = fc
  .record({
    ticketNumber: ticketNumberArb,
    position: positionArb,
    estimatedWaitMinutes: waitArb,
  })
  .map(
    ({ ticketNumber, position, estimatedWaitMinutes }): JoinedTicket => ({
      id: 'ticket-id',
      orgId: 'org-id',
      serviceId: 'service-id',
      ticketNumber,
      dailyNumber: position + 1,
      status: TicketStatus.WAITING,
      recallCount: 0,
      isRejoin: false,
      createdAt: '2024-01-01T00:00:00.000Z',
      position,
      estimatedWaitMinutes,
    }),
  );

/**
 * A WAITING ticket-status response (`TicketStatusView`). `projectTicketStatus`
 * exposes live `position`/`estimatedWaitMinutes` only while WAITING, so we
 * generate WAITING tickets to exercise the verbatim pass-through there.
 */
const waitingStatusArb: fc.Arbitrary<TicketStatusView> = fc
  .record({
    ticketNumber: ticketNumberArb,
    position: positionArb,
    estimatedWaitMinutes: waitArb,
  })
  .map(
    ({ ticketNumber, position, estimatedWaitMinutes }): TicketStatusView => ({
      id: 'ticket-id',
      orgId: 'org-id',
      serviceId: 'service-id',
      ticketNumber,
      dailyNumber: position + 1,
      status: TicketStatus.WAITING,
      recallCount: 0,
      isRejoin: false,
      createdAt: '2024-01-01T00:00:00.000Z',
      position,
      estimatedWaitMinutes,
    }),
  );

// --- properties --------------------------------------------------------------

describe('Property 4: Position and wait are displayed verbatim (no client offset)', () => {
  it('toJoinedTicketDisplay passes backend position and estimatedWaitMinutes through verbatim (R2.4)', () => {
    fc.assert(
      fc.property(joinedTicketArb, (ticket) => {
        const display = toJoinedTicketDisplay(ticket);

        // Strict equality — same value AND same type. No +1/-1, no scaling.
        expect(display.position).toBe(ticket.position);
        expect(display.estimatedWaitMinutes).toBe(ticket.estimatedWaitMinutes);

        // Guard explicitly against the common off-by-one client offsets.
        expect(display.position).not.toBe(ticket.position + 1);
        expect(display.position).not.toBe(ticket.position - 1);

        // The ticket number is also surfaced unchanged.
        expect(display.ticketNumber).toBe(ticket.ticketNumber);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('projectTicketStatus exposes the same backend position and wait verbatim while WAITING (R2.4)', () => {
    fc.assert(
      fc.property(waitingStatusArb, (ticket) => {
        const projected = projectTicketStatus(ticket);

        // For WAITING tickets the live figures are shown, and they equal the
        // backend values exactly — no client-side arithmetic.
        expect(projected.position).toBe(ticket.position);
        expect(projected.estimatedWaitMinutes).toBe(ticket.estimatedWaitMinutes);

        expect(projected.position).not.toBe((ticket.position as number) + 1);
        expect(projected.position).not.toBe((ticket.position as number) - 1);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('both projections agree on the displayed numbers for the same backend values (R2.4)', () => {
    fc.assert(
      fc.property(
        positionArb,
        waitArb,
        ticketNumberArb,
        (position, estimatedWaitMinutes, ticketNumber) => {
          const base = {
            id: 'ticket-id',
            orgId: 'org-id',
            serviceId: 'service-id',
            ticketNumber,
            dailyNumber: position + 1,
            status: TicketStatus.WAITING,
            recallCount: 0,
            isRejoin: false,
            createdAt: '2024-01-01T00:00:00.000Z',
          } as const;

          const joinDisplay = toJoinedTicketDisplay({ ...base, position, estimatedWaitMinutes });
          const statusView = projectTicketStatus({ ...base, position, estimatedWaitMinutes });

          // The same backend numbers project identically through both paths —
          // confirming neither applies its own offset.
          expect(joinDisplay.position).toBe(position);
          expect(statusView.position).toBe(position);
          expect(joinDisplay.estimatedWaitMinutes).toBe(estimatedWaitMinutes);
          expect(statusView.estimatedWaitMinutes).toBe(estimatedWaitMinutes);
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });
});
