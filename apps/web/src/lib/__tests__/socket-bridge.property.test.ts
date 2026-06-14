// Feature: web-app, Property 8: Socket queue events invalidate the matching query key
// Feature: web-app, Property 11: Subscription lifecycle is consistent across mount, unmount, and reconnect
import { WS_EVENTS } from '@queuenow/shared-constants';
import type { IQueueUpdateEvent, ITicketCalledEvent, TicketStatus } from '@queuenow/shared-types';
import type { QueryKey } from '@tanstack/react-query';
import fc from 'fast-check';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { queryKeys } from '@/lib/api/query-keys';
import {
  disconnectSocket,
  getSubscribedRooms,
  queueKeysForEvent,
  type RoomDescriptor,
  subscribeRoom,
  unsubscribeRoom,
} from '@/lib/socket';
import { createMockSocketClient, createTestQueryClient } from '@/test/harness';

/**
 * Properties 8 & 11 for the realtime layer (`lib/socket.ts`).
 *
 * Property 8 — Socket queue events invalidate the matching query key.
 *   Validates: Requirements 3.6, 6.12, 7.3 (task scope: 3.5, 3.6, 3.7, 3.10, 6.12, 7.3).
 *
 * Property 11 — Subscription lifecycle is consistent across mount, unmount, reconnect.
 *   Validates: Requirements 3.5, 3.7, 3.10.
 *
 * IMPORTANT — contract note on "orgId" (design wording vs. implementation):
 * The design text for Property 8 says events "carry an orgId (and optional
 * serviceId)". The REAL wire payloads (`IQueueUpdateEvent` / `ITicketCalledEvent`)
 * do NOT carry an orgId — the server scopes delivery by room, so the org(s) come
 * from the subscription REGISTRY, and only the `serviceId` comes from the
 * payload. The implemented, testable contract is therefore the pure helper
 * `queueKeysForEvent(rooms, eventServiceId)`. These tests exercise that actual
 * contract (rooms + eventServiceId) rather than the literal design phrasing.
 */

/** Min generated cases per property (design requires ≥100). */
const RUNS_PURE = 200;
const RUNS_BEHAVIORAL = 100;

// --- shared helpers ----------------------------------------------------------

/** Small org pool so generated rooms overlap (forces de-dup + ref-count > 1). */
const ORG_IDS = ['o1', 'o2', 'o3'] as const;
/** Small service pool, plus the org-level (undefined) case. */
const SERVICE_IDS = ['s1', 's2', 's3'] as const;

/** Stable string identity for a query key so we can compare keys as a set. */
function serializeKey(key: QueryKey): string {
  return JSON.stringify(key);
}

/** Stable string identity for a room descriptor (matches `lib/socket.ts`). */
function roomKeyString(room: RoomDescriptor): string {
  return `${room.orgId}::${room.serviceId ?? ''}`;
}

/** A room: always an org, optionally narrowed to a service. */
const roomArb = (): fc.Arbitrary<RoomDescriptor> =>
  fc.record(
    {
      orgId: fc.constantFrom(...ORG_IDS),
      serviceId: fc.option(fc.constantFrom(...SERVICE_IDS), { nil: undefined }),
    },
    { requiredKeys: ['orgId'] },
  );

const roomsArb = (): fc.Arbitrary<RoomDescriptor[]> =>
  fc.array(roomArb(), { minLength: 0, maxLength: 8 });

/**
 * Event service scope: a known service, `undefined` (org-scoped event such as
 * `queue:ticket-called`), or a service NOT in the room pool (so service-level
 * rooms must NOT match it).
 */
const eventServiceArb = (): fc.Arbitrary<string | undefined> =>
  fc.constantFrom(...SERVICE_IDS, 's-unknown', undefined);

/**
 * Independent oracle for Property 8. Recomputes the expected invalidated key set
 * directly from the DOCUMENTED rule — it deliberately does NOT call
 * `queueKeysForEvent`, so the test can fail if the implementation drifts.
 *
 * Rule (per the module's documented contract):
 *  - org-level rooms (no serviceId) are ALWAYS affected;
 *  - service-level rooms are affected only when the event's service matches;
 *  - an org-scoped event (eventServiceId === undefined) affects ALL rooms.
 * Keys are de-duplicated by room identity.
 */
function expectedKeySet(
  rooms: readonly RoomDescriptor[],
  eventServiceId: string | undefined,
): Set<string> {
  const keys = new Set<string>();
  for (const room of rooms) {
    let affected: boolean;
    if (eventServiceId === undefined) {
      affected = true;
    } else if (room.serviceId === undefined) {
      affected = true;
    } else {
      affected = room.serviceId === eventServiceId;
    }
    if (affected) {
      keys.add(serializeKey(queryKeys.queue(room.orgId, room.serviceId)));
    }
  }
  return keys;
}

/** Build a `queue:update` payload carrying a given service scope. */
function queueUpdateEvent(serviceId: string | undefined): IQueueUpdateEvent {
  return {
    type: 'TICKET_CALLED',
    ticket: {
      id: 't1',
      ticketNumber: 'A001',
      status: 'CALLED' as TicketStatus,
      serviceId,
    },
  };
}

/** A representative org-scoped `queue:ticket-called` payload (no serviceId on the wire). */
const TICKET_CALLED_EVENT: ITicketCalledEvent = {
  ticketNumber: 'A001',
  counterName: 'Counter 1',
  serviceName: 'General',
};

afterEach(() => {
  // Clears the module-scoped subscription registry + connection state.
  disconnectSocket();
  vi.restoreAllMocks();
});

describe('Property 8: socket queue events invalidate the matching query key', () => {
  it('queueKeysForEvent returns exactly the de-duplicated matching key set (oracle)', () => {
    fc.assert(
      fc.property(roomsArb(), eventServiceArb(), (rooms, eventServiceId) => {
        const actual = queueKeysForEvent(rooms, eventServiceId);
        const actualSet = new Set(actual.map(serializeKey));

        // Exactly the expected keys — and no unrelated key (set equality).
        expect(actualSet).toEqual(expectedKeySet(rooms, eventServiceId));

        // De-duplicated: the returned array carries no repeated key.
        expect(actual.length).toBe(actualSet.size);
      }),
      { numRuns: RUNS_PURE },
    );
  });

  it('a service-scoped queue:update matches org-level rooms always and service rooms only on match', () => {
    fc.assert(
      fc.property(roomsArb(), fc.constantFrom(...SERVICE_IDS), (rooms, scope) => {
        const resultSet = new Set(queueKeysForEvent(rooms, scope).map(serializeKey));

        for (const room of rooms) {
          const key = serializeKey(queryKeys.queue(room.orgId, room.serviceId));
          if (room.serviceId === undefined || room.serviceId === scope) {
            expect(resultSet.has(key)).toBe(true);
          } else {
            // A service-level room for a DIFFERENT service must not be invalidated
            // (unless another generated room maps to the same key — guarded below).
            const collides = rooms.some(
              (other) =>
                roomKeyString(other) !== roomKeyString(room) &&
                serializeKey(queryKeys.queue(other.orgId, other.serviceId)) === key &&
                (other.serviceId === undefined || other.serviceId === scope),
            );
            expect(resultSet.has(key)).toBe(collides);
          }
        }
      }),
      { numRuns: RUNS_PURE },
    );
  });

  it('an org-scoped queue:ticket-called refreshes every tracked room for the org(s)', () => {
    fc.assert(
      fc.property(roomsArb(), (rooms) => {
        const resultSet = new Set(queueKeysForEvent(rooms, undefined).map(serializeKey));
        const allRoomKeys = new Set(
          rooms.map((room) => serializeKey(queryKeys.queue(room.orgId, room.serviceId))),
        );
        // Org-scoped event → all distinct tracked room keys, nothing more.
        expect(resultSet).toEqual(allRoomKeys);
      }),
      { numRuns: RUNS_PURE },
    );
  });

  it('bridge: emitted events invalidate exactly the oracle key set (mock socket → QueryClient)', () => {
    fc.assert(
      fc.property(roomsArb(), eventServiceArb(), (rooms, eventServiceId) => {
        const socket = createMockSocketClient();
        const queryClient = createTestQueryClient();
        const spy = vi.spyOn(queryClient, 'invalidateQueries').mockReturnValue(Promise.resolve());
        socket.bridgeTo(queryClient);

        for (const room of rooms) {
          socket.subscribeRoom(room);
        }

        if (eventServiceId === undefined) {
          socket.emitTicketCalled(TICKET_CALLED_EVENT);
        } else {
          socket.emitQueueUpdate(queueUpdateEvent(eventServiceId));
        }

        const invalidated = new Set(
          spy.mock.calls.map(([arg]) => serializeKey((arg?.queryKey ?? []) as QueryKey)),
        );
        expect(invalidated).toEqual(expectedKeySet(rooms, eventServiceId));

        socket.reset();
        queryClient.clear();
        spy.mockRestore();
      }),
      { numRuns: RUNS_BEHAVIORAL },
    );
  });
});

// --- Property 11 -------------------------------------------------------------

/** A single mount/unmount operation against a room. */
interface LifecycleOp {
  kind: 'sub' | 'unsub';
  room: RoomDescriptor;
}

const opArb = (): fc.Arbitrary<LifecycleOp> =>
  fc.record({
    kind: fc.constantFrom<'sub' | 'unsub'>('sub', 'unsub'),
    room: roomArb(),
  });

const opsArb = (): fc.Arbitrary<LifecycleOp[]> =>
  fc.array(opArb(), { minLength: 1, maxLength: 30 });

/**
 * Reference model of the ref-counted registry: roomKey → net subscriber count.
 * Mirrors the documented semantics (first sub registers; unsub of an unknown
 * room is a no-op; the last unsub releases the room). The active room set is
 * exactly the keys present (all present entries have count ≥ 1).
 */
class RegistryModel {
  private readonly counts = new Map<string, { descriptor: RoomDescriptor; count: number }>();

  sub(room: RoomDescriptor): void {
    const key = roomKeyString(room);
    const entry = this.counts.get(key);
    if (entry) {
      entry.count += 1;
    } else {
      this.counts.set(key, { descriptor: room, count: 1 });
    }
  }

  unsub(room: RoomDescriptor): void {
    const key = roomKeyString(room);
    const entry = this.counts.get(key);
    if (!entry) {
      return;
    }
    entry.count -= 1;
    if (entry.count <= 0) {
      this.counts.delete(key);
    }
  }

  activeKeys(): Set<string> {
    return new Set(this.counts.keys());
  }
}

/** The set of active room keys reported by an implementation. */
function activeKeysOf(rooms: readonly RoomDescriptor[]): Set<string> {
  return new Set(rooms.map(roomKeyString));
}

describe('Property 11: subscription lifecycle is consistent across mount, unmount, reconnect', () => {
  it('the active room set always equals the rooms with a positive net subscriber count (real registry)', () => {
    fc.assert(
      fc.property(opsArb(), (ops) => {
        // Fresh module state per case.
        disconnectSocket();
        const model = new RegistryModel();

        for (const op of ops) {
          if (op.kind === 'sub') {
            subscribeRoom(op.room);
            model.sub(op.room);
          } else {
            unsubscribeRoom(op.room);
            model.unsub(op.room);
          }
          // Invariant holds after EVERY operation, not just at the end.
          expect(activeKeysOf(getSubscribedRooms())).toEqual(model.activeKeys());
        }
      }),
      { numRuns: RUNS_BEHAVIORAL },
    );
  });

  it('a room is released only when its last subscriber unsubscribes (ref-counting)', () => {
    fc.assert(
      fc.property(roomArb(), fc.integer({ min: 1, max: 6 }), (room, mounts) => {
        disconnectSocket();
        const key = roomKeyString(room);

        for (let i = 0; i < mounts; i += 1) {
          subscribeRoom(room);
          expect(activeKeysOf(getSubscribedRooms()).has(key)).toBe(true);
        }
        // Each unsubscribe except the last keeps the room active.
        for (let i = 0; i < mounts - 1; i += 1) {
          unsubscribeRoom(room);
          expect(activeKeysOf(getSubscribedRooms()).has(key)).toBe(true);
        }
        // The last unsubscribe releases the room.
        unsubscribeRoom(room);
        expect(activeKeysOf(getSubscribedRooms()).has(key)).toBe(false);
      }),
      { numRuns: RUNS_BEHAVIORAL },
    );
  });

  it('on reconnect, exactly the currently-active rooms are re-subscribed (mock socket)', () => {
    fc.assert(
      fc.property(opsArb(), opsArb(), (firstOps, secondOps) => {
        const socket = createMockSocketClient();
        const model = new RegistryModel();

        const apply = (ops: readonly LifecycleOp[]): void => {
          for (const op of ops) {
            if (op.kind === 'sub') {
              socket.subscribeRoom(op.room);
              model.sub(op.room);
            } else {
              socket.unsubscribeRoom(op.room);
              model.unsub(op.room);
            }
          }
        };

        // Mount/unmount while disconnected, then connect (reconnect).
        apply(firstOps);
        expect(activeKeysOf(socket.getSubscribedRooms())).toEqual(model.activeKeys());

        socket.connect();
        const firstResub = new Set(
          socket
            .getSentMessages()
            .filter((m) => m.event === WS_EVENTS.SUBSCRIBE)
            .map((m) => roomKeyString(m.descriptor)),
        );
        // Re-subscription on connect targets exactly the active set.
        expect(firstResub).toEqual(model.activeKeys());

        // Further mounts/unmounts while connected, then a drop + reconnect.
        apply(secondOps);
        expect(activeKeysOf(socket.getSubscribedRooms())).toEqual(model.activeKeys());

        // Isolate the reconnect: mark the message log immediately before connect.
        // `disconnect` emits nothing, so everything after this index is the
        // re-subscription burst produced by `connect()`.
        socket.disconnect();
        const beforeReconnect = socket.getSentMessages().length;
        socket.connect();

        const reconnectResub = new Set(
          socket
            .getSentMessages()
            .slice(beforeReconnect)
            .filter((m) => m.event === WS_EVENTS.SUBSCRIBE)
            .map((m) => roomKeyString(m.descriptor)),
        );
        // The reconnect re-subscribe set equals exactly the current active set.
        expect(reconnectResub).toEqual(model.activeKeys());

        socket.reset();
      }),
      { numRuns: RUNS_BEHAVIORAL },
    );
  });
});
