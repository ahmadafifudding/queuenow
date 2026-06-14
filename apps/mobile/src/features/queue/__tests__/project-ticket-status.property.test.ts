// Feature: customer-mobile-app, Property 5: Ticket status projection
//
// Validates: Requirements 3.1, 3.4, 3.5
//
// For any ticket-status response, the projected view (`projectTicketStatus`):
//
//   - exposes live `position` / `estimatedWaitMinutes` ONLY when `status` is
//     `WAITING` (R3.1) — for every other status both fields are suppressed to
//     `null`, so a stale backend value can never leak into a non-WAITING view;
//   - includes the assigned counter name when `status` is `CALLED` and a counter
//     is present (R3.4) (and, per the implementation, while `SERVING`);
//   - exposes a terminal flag (`isTerminal === true`) with NO live position/wait
//     when `status` is `COMPLETED` or `SKIPPED` (R3.5).
//
// `projectTicketStatus` is pure (no I/O, no `Date`, no randomness) and only
// imports the `TicketStatus` enum + the `TicketStatusView` type, so it is
// exercised directly with no native-module stubbing.
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import {
  projectTicketStatus,
  type ProjectedTicketStatus,
} from '@/features/queue/project-ticket-status';
import type { TicketStatusView } from '@/lib/view-models';
import { TicketStatus } from '@queuenow/shared-types';

// --- arbitraries -----------------------------------------------------------

/** A non-empty identifier-ish string (ticket id, orgId, serviceId, …). */
const idArb: fc.Arbitrary<string> = fc
  .string({ minLength: 1, maxLength: 24 })
  .filter((s) => s.trim().length > 0);

/** An ISO-8601 timestamp string. */
const isoArb: fc.Arbitrary<string> = fc
  .date({ min: new Date('2020-01-01T00:00:00.000Z'), max: new Date('2035-01-01T00:00:00.000Z') })
  .map((d) => d.toISOString());

/** A live integer field (`position`/`estimatedWaitMinutes`) or `null`. */
const liveNumberArb: fc.Arbitrary<number | null> = fc.option(fc.integer({ min: 0, max: 9999 }), {
  nil: null,
});

/** Any ticket status, covering WAITING/CALLED/SERVING/COMPLETED/SKIPPED. */
const statusArb: fc.Arbitrary<TicketStatus> = fc.constantFrom(...Object.values(TicketStatus));

/** An assigned counter, or `null`/omitted. */
const counterArb: fc.Arbitrary<{ id: string; name: string } | null> = fc.option(
  fc.record({ id: idArb, name: fc.string({ minLength: 1, maxLength: 20 }) }),
  { nil: null },
);

/** An optional service augmentation. */
const serviceArb: fc.Arbitrary<TicketStatusView['service']> = fc.option(
  fc.record({
    id: idArb,
    name: fc.string({ minLength: 1, maxLength: 20 }),
    prefix: fc.string({ minLength: 1, maxLength: 3 }),
    avgServingTime: fc.integer({ min: 1, max: 120 }),
  }),
  { nil: undefined },
);

/**
 * A complete {@link TicketStatusView} across all statuses, with arbitrary
 * `position` / `estimatedWaitMinutes` / `counter` so the projection rules are
 * exercised independently of status (e.g. a stale `position` on a terminal
 * ticket, a present counter while `WAITING`, etc.).
 */
const ticketArb: fc.Arbitrary<TicketStatusView> = fc.record({
  id: idArb,
  orgId: idArb,
  serviceId: idArb,
  counterId: fc.option(idArb, { nil: null }),
  ticketNumber: fc.string({ minLength: 1, maxLength: 8 }),
  dailyNumber: fc.integer({ min: 1, max: 9999 }),
  status: statusArb,
  customerName: fc.option(fc.string(), { nil: null }),
  customerPhone: fc.option(fc.string(), { nil: null }),
  customerProfileId: fc.option(idArb, { nil: null }),
  calledAt: fc.option(isoArb, { nil: null }),
  completedAt: fc.option(isoArb, { nil: null }),
  skippedAt: fc.option(isoArb, { nil: null }),
  recallCount: fc.integer({ min: 0, max: 10 }),
  isRejoin: fc.boolean(),
  createdAt: isoArb,
  position: liveNumberArb,
  estimatedWaitMinutes: liveNumberArb,
  counter: counterArb,
  service: serviceArb,
});

/** The exact key set of the projected shape — guards against drift. */
const PROJECTED_KEYS = [
  'status',
  'ticketNumber',
  'isTerminal',
  'position',
  'estimatedWaitMinutes',
  'counterName',
  'service',
].sort();

// --- properties ------------------------------------------------------------

describe('Property 5: Ticket status projection', () => {
  it('exposes live position/wait verbatim ONLY when WAITING; nulls them otherwise (R3.1)', () => {
    fc.assert(
      fc.property(ticketArb, (ticket) => {
        const view: ProjectedTicketStatus = projectTicketStatus(ticket);

        if (ticket.status === TicketStatus.WAITING) {
          // Verbatim: no client-side arithmetic — exactly the backend value
          // (with the implementation's null-coalescing of `undefined`).
          expect(view.position).toBe(ticket.position ?? null);
          expect(view.estimatedWaitMinutes).toBe(ticket.estimatedWaitMinutes ?? null);
        } else {
          // Live queue figures are suppressed for every non-WAITING status.
          expect(view.position).toBeNull();
          expect(view.estimatedWaitMinutes).toBeNull();
        }
      }),
      { numRuns: 100 },
    );
  });

  it('includes the assigned counter name when CALLED (and SERVING) with a counter; null otherwise (R3.4)', () => {
    fc.assert(
      fc.property(ticketArb, (ticket) => {
        const view = projectTicketStatus(ticket);
        const counter = ticket.counter ?? null;
        const counterEligible =
          ticket.status === TicketStatus.CALLED || ticket.status === TicketStatus.SERVING;

        if (counterEligible && counter !== null) {
          // The counter is named once CALLED (R3.4); surfaced verbatim.
          expect(view.counterName).toBe(counter.name);
        } else {
          // No counter assigned, or a status with no counter to present.
          expect(view.counterName).toBeNull();
        }
      }),
      { numRuns: 100 },
    );
  });

  it('flags terminal states (COMPLETED/SKIPPED) with no live position/wait; non-terminal otherwise (R3.5)', () => {
    fc.assert(
      fc.property(ticketArb, (ticket) => {
        const view = projectTicketStatus(ticket);
        const isTerminal =
          ticket.status === TicketStatus.COMPLETED || ticket.status === TicketStatus.SKIPPED;

        expect(view.isTerminal).toBe(isTerminal);

        if (isTerminal) {
          // Terminal tickets carry no live queue information (R3.5).
          expect(view.position).toBeNull();
          expect(view.estimatedWaitMinutes).toBeNull();
        }
      }),
      { numRuns: 100 },
    );
  });

  it('preserves status/ticketNumber/service verbatim and matches the exact projected shape', () => {
    fc.assert(
      fc.property(ticketArb, (ticket) => {
        const view = projectTicketStatus(ticket);

        // Pass-through fields are surfaced unchanged.
        expect(view.status).toBe(ticket.status);
        expect(view.ticketNumber).toBe(ticket.ticketNumber);
        expect(view.service).toEqual(ticket.service);

        // The projected view exposes exactly the ProjectedTicketStatus keys —
        // no extra/leaked fields (e.g. customer PII, ids) escape the projection.
        expect(Object.keys(view).sort()).toEqual(PROJECTED_KEYS);
      }),
      { numRuns: 100 },
    );
  });
});
