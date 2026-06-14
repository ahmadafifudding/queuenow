// Feature: customer-mobile-app, Property 6: Ticket-update bridge targets the matching query key
//
// Validates: Requirements 3.3
//
// `queueKeysForEvent` is the PURE socket-bridge core (R3.3): given an incoming
// `ticket:update` payload and the currently-tracked tickets, it returns EXACTLY
// the TanStack Query keys to invalidate. The wire payload carries only
// `ticket.id` (delivery is scoped by the `ticket:<ticketId>` room), so the
// tracked tickets supply the `orgId` needed to build
// `queryKeys.ticket(orgId, ticketId)`.
//
// This property pins three behaviors across arbitrary inputs:
//  - for an event whose `ticket.id` matches a tracked ticket, the result is
//    exactly `queryKeys.ticket(orgId, ticketId)` for that tracked ticket;
//  - for an event whose `ticket.id` is NOT tracked, the result is empty;
//  - the result is de-duplicated (a tracked ticket repeated verbatim still
//    contributes a single key), and an event with no `ticket.id` yields none.
//
// `queueKeysForEvent` and `queryKeys` are pure and import no expo-* native
// modules, so this property needs none of the native-module `vi.mock` stubs
// used by the REST-client tests.
import type { IQueueUpdateEvent } from '@queuenow/shared-types';
import { TicketStatus } from '@queuenow/shared-types';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { queryKeys } from '@/lib/api/query-keys';
import { queueKeysForEvent, type TrackedTicket } from '@/lib/socket-registry';

/** Identifier arbitrary (non-empty, modest length) for ticket ids and org ids. */
const idArb: fc.Arbitrary<string> = fc.string({ minLength: 1, maxLength: 16 });

/** The `ticket:update` event `type` discriminant (any gateway-emitted value). */
const eventTypeArb: fc.Arbitrary<IQueueUpdateEvent['type']> = fc.constantFrom(
  'TICKET_JOINED',
  'TICKET_CALLED',
  'TICKET_RECALLED',
  'TICKET_SKIPPED',
  'TICKET_COMPLETED',
  'TICKET_REJOINED',
);

/** Any ticket status (verbatim from the backend). */
const statusArb: fc.Arbitrary<TicketStatus> = fc.constantFrom(...Object.values(TicketStatus));

/**
 * A tracked ticket subscription. `orgId`/`ticketId` are independent ids so the
 * generator explores the org-recovery that the wire payload cannot carry.
 */
const trackedTicketArb: fc.Arbitrary<TrackedTicket> = fc.record({
  ticketId: idArb,
  orgId: idArb,
});

/**
 * A list of tracked tickets with UNIQUE `ticketId`s — this mirrors the real
 * input space, since `SubscriptionRegistry` keys tracked tickets by `ticketId`
 * and therefore never holds two entries with the same id.
 */
const trackedListArb: fc.Arbitrary<TrackedTicket[]> = fc.uniqueArray(trackedTicketArb, {
  selector: (t) => t.ticketId,
  maxLength: 8,
});

/**
 * Build a `ticket:update` payload for `ticketId` with arbitrary type/status and
 * ticket number — none of which affect the bridge's key targeting.
 */
function buildEvent(
  ticketId: string,
  type: IQueueUpdateEvent['type'],
  status: TicketStatus,
  ticketNumber: string,
): IQueueUpdateEvent {
  return { type, ticket: { id: ticketId, ticketNumber, status } };
}

/** Stable serialization for order-insensitive query-key comparison. */
function serializeKeys(keys: readonly unknown[]): string[] {
  return keys.map((k) => JSON.stringify(k)).sort();
}

describe('Property 6: Ticket-update bridge targets the matching query key', () => {
  it('produces exactly queryKeys.ticket(orgId, ticketId) for the tracked ticket matching the event, and none otherwise', () => {
    fc.assert(
      fc.property(
        // tracked tickets + whether the event should target an existing one
        trackedListArb.chain((tracked) => {
          const taken = new Set(tracked.map((t) => t.ticketId));
          const eventIdArb =
            tracked.length > 0
              ? fc.oneof(
                  // match an existing tracked ticket...
                  fc.constantFrom(...tracked.map((t) => t.ticketId)),
                  // ...or a fresh, non-tracked id (no match expected)
                  idArb.filter((id) => !taken.has(id)),
                )
              : idArb.filter((id) => !taken.has(id));
          return fc.tuple(fc.constant(tracked), eventIdArb);
        }),
        eventTypeArb,
        statusArb,
        fc.string(),
        ([tracked, eventTicketId], type, status, ticketNumber) => {
          const event = buildEvent(eventTicketId, type, status, ticketNumber);

          const result = queueKeysForEvent(event, tracked);

          // Expected: the (unique) tracked ticket whose id matches the event.
          const match = tracked.find((t) => t.ticketId === eventTicketId);
          const expected = match ? [queryKeys.ticket(match.orgId, match.ticketId)] : [];

          // EXACTLY the expected keys — no more, no fewer.
          expect(serializeKeys(result)).toStrictEqual(serializeKeys(expected));

          // Cross-check: no key references a ticketId other than the event's,
          // and every produced key carries the matching tracked orgId.
          for (const key of result) {
            expect(key).toStrictEqual(['ticket', match?.orgId, eventTicketId]);
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it('produces no key when the event carries no ticket id (undefined / empty)', () => {
    fc.assert(
      fc.property(
        trackedListArb,
        eventTypeArb,
        statusArb,
        fc.string(),
        fc.constantFrom<string | undefined>(undefined, ''),
        (tracked, type, status, ticketNumber, emptyId) => {
          const event: IQueueUpdateEvent = {
            type,
            ticket: { id: emptyId as string, ticketNumber, status },
          };
          expect(queueKeysForEvent(event, tracked)).toStrictEqual([]);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('de-duplicates: a matching tracked ticket repeated verbatim still yields a single key', () => {
    fc.assert(
      fc.property(
        trackedTicketArb,
        fc.integer({ min: 1, max: 5 }),
        eventTypeArb,
        statusArb,
        fc.string(),
        (matchTicket, repeats, type, status, ticketNumber) => {
          // The same (orgId, ticketId) tracked entry repeated `repeats` times.
          const tracked: TrackedTicket[] = Array.from({ length: repeats }, () => ({
            ...matchTicket,
          }));
          const event = buildEvent(matchTicket.ticketId, type, status, ticketNumber);

          const result = queueKeysForEvent(event, tracked);

          // De-duplicated down to exactly one key for the matching ticket.
          expect(result).toStrictEqual([queryKeys.ticket(matchTicket.orgId, matchTicket.ticketId)]);
        },
      ),
      { numRuns: 100 },
    );
  });
});
