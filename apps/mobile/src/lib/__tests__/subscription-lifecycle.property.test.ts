// Feature: customer-mobile-app, Property 7: Subscription lifecycle is consistent across mount, unmount, and reconnect
//
// Validates: Requirements 4.1, 4.2, 4.3, 4.6
//
// For any sequence of subscribe/unsubscribe calls (tickets and rooms) against the
// pure `SubscriptionRegistry`:
//   - the registry's tracked set always equals the set of currently-mounted
//     subscribers (entries whose ref-count is > 0);
//   - the FIRST subscriber for an entry yields exactly one `'subscribe'` (the wire
//     `subscribe` / `subscribe:ticket`), the LAST unsubscribe yields exactly one
//     `'unsubscribe'`, and every other add/remove is a `'noop'`;
//   - ref-counts never go negative; removing an untracked entry is a `'noop'`;
//   - the running total of `'subscribe'` results minus `'unsubscribe'` results
//     equals the number of currently-tracked entries.
//
// The decision results map onto WS_EVENTS names (`SUBSCRIBE` / `SUBSCRIBE_TICKET`
// for a `'subscribe'`, `UNSUBSCRIBE` for an `'unsubscribe'`); we assert that
// contract here so the registry stays aligned with the gateway vocabulary (R4.6).
//
// The registry is pure and socket-free, so no native modules / vi.mock stubs are
// needed — the test drives it directly and checks it against an independent
// ref-count oracle after every operation.
import { WS_EVENTS } from '@queuenow/shared-constants';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import {
  type AddResult,
  type RemoveResult,
  roomKey,
  SubscriptionRegistry,
  ticketKey,
  type TrackedRoom,
} from '@/lib/socket-registry';

/** Minimum fast-check iterations per property (design requires ≥100). */
const NUM_RUNS = 100;

// --- generators --------------------------------------------------------------

/**
 * Small ticket pool so generated ops collide and exercise ref-counts > 1. Each
 * ticketId has a FIXED orgId (the registry keys on ticketId alone, so keeping a
 * stable org per ticket keeps the oracle unambiguous about the tracked entry).
 */
const TICKET_POOL = [
  { ticketId: 't1', orgId: 'o1' },
  { ticketId: 't2', orgId: 'o1' },
  { ticketId: 't3', orgId: 'o2' },
] as const;

/** Small room pool (org-level + service-scoped) so room keys collide too. */
const ROOM_POOL: readonly TrackedRoom[] = [
  { orgId: 'o1' },
  { orgId: 'o1', serviceId: 's1' },
  { orgId: 'o1', serviceId: 's2' },
  { orgId: 'o2' },
  { orgId: 'o2', serviceId: 's1' },
];

type Op =
  | { target: 'ticket'; kind: 'add' | 'remove'; ticketId: string; orgId: string }
  | { target: 'room'; kind: 'add' | 'remove'; room: TrackedRoom };

const ticketOpArb = (): fc.Arbitrary<Op> =>
  fc
    .record({
      target: fc.constant<'ticket'>('ticket'),
      kind: fc.constantFrom<'add' | 'remove'>('add', 'remove'),
      pick: fc.constantFrom(...TICKET_POOL),
    })
    .map(({ target, kind, pick }) => ({
      target,
      kind,
      ticketId: pick.ticketId,
      orgId: pick.orgId,
    }));

const roomOpArb = (): fc.Arbitrary<Op> =>
  fc.record({
    target: fc.constant<'room'>('room'),
    kind: fc.constantFrom<'add' | 'remove'>('add', 'remove'),
    room: fc.constantFrom(...ROOM_POOL),
  });

const opArb = (): fc.Arbitrary<Op> => fc.oneof(ticketOpArb(), roomOpArb());

const opsArb = (): fc.Arbitrary<Op[]> => fc.array(opArb(), { minLength: 0, maxLength: 40 });

/**
 * A balanced sequence: a random sequence of adds followed by enough removes to
 * drain every entry back to zero (each add is paired with exactly one remove).
 * Removes are emitted in a shuffled order to exercise interleaving.
 */
const balancedOpsArb = (): fc.Arbitrary<Op[]> =>
  fc
    .array(
      fc.oneof(
        fc
          .constantFrom(...TICKET_POOL)
          .map(
            (p): Op => ({ target: 'ticket', kind: 'add', ticketId: p.ticketId, orgId: p.orgId }),
          ),
        fc.constantFrom(...ROOM_POOL).map((room): Op => ({ target: 'room', kind: 'add', room })),
      ),
      { minLength: 0, maxLength: 20 },
    )
    .chain((adds) => {
      const removes: Op[] = adds.map((op) =>
        op.target === 'ticket'
          ? { target: 'ticket', kind: 'remove', ticketId: op.ticketId, orgId: op.orgId }
          : { target: 'room', kind: 'remove', room: op.room },
      );
      // Interleave: keep adds first (so every remove has a live entry), shuffle removes.
      return fc
        .shuffledSubarray(removes, { minLength: removes.length, maxLength: removes.length })
        .map((shuffledRemoves) => [...adds, ...shuffledRemoves]);
    });

// --- oracle ------------------------------------------------------------------

/** Stable key for an op's target, matching the registry's own key functions. */
function keyOf(op: Op): string {
  return op.target === 'ticket' ? ticketKey(op.ticketId) : roomKey(op.room);
}

/**
 * Independent ref-count model. Recomputes the EXPECTED decision and tracked set
 * from first principles (it never calls the registry), so the test fails if the
 * implementation drifts.
 */
class RefCountModel {
  private readonly tickets = new Map<string, number>();
  private readonly rooms = new Map<string, number>();

  private bucket(op: Op): Map<string, number> {
    return op.target === 'ticket' ? this.tickets : this.rooms;
  }

  /** Apply an op and return the decision the registry must have produced. */
  apply(op: Op): AddResult | RemoveResult {
    const map = this.bucket(op);
    const key = keyOf(op);
    const current = map.get(key) ?? 0;

    if (op.kind === 'add') {
      const next = current + 1;
      map.set(key, next);
      return next === 1 ? 'subscribe' : 'noop';
    }

    // remove
    if (current <= 0) {
      return 'noop'; // removing an untracked entry
    }
    const next = current - 1;
    if (next <= 0) {
      map.delete(key);
      return 'unsubscribe';
    }
    map.set(key, next);
    return 'noop';
  }

  ticketKeys(): Set<string> {
    return new Set(this.tickets.keys());
  }

  roomKeys(): Set<string> {
    return new Set(this.rooms.keys());
  }

  ticketCount(key: string): number {
    return this.tickets.get(key) ?? 0;
  }

  roomCount(key: string): number {
    return this.rooms.get(key) ?? 0;
  }

  /** Total currently-tracked entries (tickets + rooms). */
  trackedTotal(): number {
    return this.tickets.size + this.rooms.size;
  }
}

/** Drive one op against the real registry, returning its decision. */
function applyToRegistry(reg: SubscriptionRegistry, op: Op): AddResult | RemoveResult {
  if (op.target === 'ticket') {
    return op.kind === 'add' ? reg.addTicket(op.ticketId, op.orgId) : reg.removeTicket(op.ticketId);
  }
  return op.kind === 'add' ? reg.addRoom(op.room) : reg.removeRoom(op.room);
}

/** The decision result maps to a WS_EVENTS wire name (or a no-op). R4.6. */
function wireEventFor(op: Op, result: AddResult | RemoveResult): string | null {
  if (result === 'subscribe') {
    return op.target === 'ticket' ? WS_EVENTS.SUBSCRIBE_TICKET : WS_EVENTS.SUBSCRIBE;
  }
  if (result === 'unsubscribe') {
    return WS_EVENTS.UNSUBSCRIBE;
  }
  return null; // 'noop' — nothing goes on the wire
}

// --- properties --------------------------------------------------------------

describe('Property 7: subscription lifecycle is consistent across mount, unmount, and reconnect', () => {
  it('tracked set, first/last transitions, and ref-counts match an independent oracle after every op', () => {
    fc.assert(
      fc.property(opsArb(), (ops) => {
        const reg = new SubscriptionRegistry();
        const model = new RefCountModel();

        // Running tally: net 'subscribe' minus 'unsubscribe' decisions.
        let netSubscribes = 0;

        for (const op of ops) {
          const expected = model.apply(op);
          const actual = applyToRegistry(reg, op);

          // First subscriber → exactly one 'subscribe'; last unsubscribe →
          // exactly one 'unsubscribe'; everything else → 'noop'.
          expect(actual).toBe(expected);

          if (actual === 'subscribe') {
            netSubscribes += 1;
          } else if (actual === 'unsubscribe') {
            netSubscribes -= 1;
          }

          // Tracked snapshots equal exactly the entries with count > 0.
          const trackedTicketKeys = new Set(reg.trackedTickets().map((t) => ticketKey(t.ticketId)));
          const trackedRoomKeys = new Set(reg.trackedRooms().map((r) => roomKey(r)));
          expect(trackedTicketKeys).toEqual(model.ticketKeys());
          expect(trackedRoomKeys).toEqual(model.roomKeys());

          // Per-entry ref-counts agree and are never negative.
          const key = keyOf(op);
          if (op.target === 'ticket') {
            const count = reg.ticketCount(op.ticketId);
            expect(count).toBe(model.ticketCount(key));
            expect(count).toBeGreaterThanOrEqual(0);
          } else {
            const count = reg.roomCount(op.room);
            expect(count).toBe(model.roomCount(key));
            expect(count).toBeGreaterThanOrEqual(0);
          }

          // The net 'subscribe' decisions equal the count of tracked entries —
          // a 'subscribe' is emitted iff an entry becomes tracked, an
          // 'unsubscribe' iff it stops being tracked.
          expect(netSubscribes).toBe(model.trackedTotal());

          // The decision maps onto a WS_EVENTS wire name (R4.6).
          const wire = wireEventFor(op, actual);
          if (actual === 'noop') {
            expect(wire).toBeNull();
          } else if (op.target === 'ticket') {
            expect(wire).toBe(actual === 'subscribe' ? 'subscribe:ticket' : 'unsubscribe');
          } else {
            expect(wire).toBe(actual === 'subscribe' ? 'subscribe' : 'unsubscribe');
          }
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('removing an untracked entry is always a noop and never drives the count negative', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...TICKET_POOL),
        fc.constantFrom(...ROOM_POOL),
        fc.integer({ min: 1, max: 5 }),
        (ticket, room, extraRemoves) => {
          const reg = new SubscriptionRegistry();

          // Removing before any add → noop, count stays at 0.
          expect(reg.removeTicket(ticket.ticketId)).toBe('noop');
          expect(reg.removeRoom(room)).toBe('noop');
          expect(reg.ticketCount(ticket.ticketId)).toBe(0);
          expect(reg.roomCount(room)).toBe(0);

          // One add, one remove → balanced; further removes stay noop at 0.
          expect(reg.addTicket(ticket.ticketId, ticket.orgId)).toBe('subscribe');
          expect(reg.removeTicket(ticket.ticketId)).toBe('unsubscribe');
          for (let i = 0; i < extraRemoves; i += 1) {
            expect(reg.removeTicket(ticket.ticketId)).toBe('noop');
            expect(reg.ticketCount(ticket.ticketId)).toBe(0);
          }
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  it('a balanced sequence drains to an empty tracked set with equal subscribe/unsubscribe counts', () => {
    fc.assert(
      fc.property(balancedOpsArb(), (ops) => {
        const reg = new SubscriptionRegistry();
        let subscribes = 0;
        let unsubscribes = 0;

        for (const op of ops) {
          const result = applyToRegistry(reg, op);
          if (result === 'subscribe') {
            subscribes += 1;
          } else if (result === 'unsubscribe') {
            unsubscribes += 1;
          }
        }

        // Balanced: the first-subscriber 'subscribe' count equals the
        // last-unsubscribe 'unsubscribe' count, and nothing remains tracked.
        expect(subscribes).toBe(unsubscribes);
        expect(reg.trackedTickets()).toEqual([]);
        expect(reg.trackedRooms()).toEqual([]);
      }),
      { numRuns: NUM_RUNS },
    );
  });
});
