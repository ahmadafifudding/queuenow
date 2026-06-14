// Feature: customer-mobile-app, Property 8: Reconnect re-issues exactly the tracked subscriptions
//
// Validates: Requirements 4.4, 9.3
//
// For any registry state, a (re)connect re-emits a `subscribe` / `subscribe:ticket`
// for EXACTLY the currently-tracked entries — no more, no fewer:
//   - exactly one `subscribe:ticket` (WS_EVENTS.SUBSCRIBE_TICKET) per tracked
//     ticket, carrying that ticket's id;
//   - exactly one `subscribe` (WS_EVENTS.SUBSCRIBE) per tracked room, carrying
//     that room's `{ orgId, serviceId? }`;
//   - no duplicate emits when an entry has a ref-count > 1 (the registry keys by
//     ticketId / roomKey, so multiple subscribers collapse to one wire emit);
//   - NOTHING is re-issued for entries that were subscribed and then fully
//     unsubscribed (they are no longer tracked).
// The same re-emission is what a connectivity-restore trigger produces: both the
// transport `connect` and the NetInfo "came online" trigger funnel through the
// single `resubscribeAll` re-issue path, so the second property drives the real
// connectivity-restore wiring (R9.3) and asserts the identical emit set.
//
// `lib/socket.ts` statically pulls in expo / react-native native modules through
// its dependency graph: `@/lib/env` (→ `expo-constants`), `@/lib/connectivity`
// (→ `@react-native-community/netinfo` + `react-native`'s `AppState`), and the
// `socket.io-client` transport. None of those are exercised by this property —
// the re-issue logic and the ref-counted registry are pure. We therefore stub
// the native boundary (the same `expo-constants` stub the client property tests
// use, plus NetInfo / `react-native` / a fake `socket.io-client` `io`) and seed
// the public env vars, so the REAL `resubscribeAll` + `SubscriptionRegistry` +
// public subscribe API under test load and run; nothing about the behavior is
// faked. The re-issue target socket is the harness fake-socket from
// `src/test-support`, which records the outgoing emits.
import { WS_EVENTS } from '@queuenow/shared-constants';
import fc from 'fast-check';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Seed the public env so `@/lib/env` validation passes when `ensureSocket()`
// reads `env.EXPO_PUBLIC_WS_URL` (no live URL is ever contacted — `io` is faked).
process.env.EXPO_PUBLIC_API_URL =
  process.env.EXPO_PUBLIC_API_URL ?? 'https://api.test.local/api/v1';
process.env.EXPO_PUBLIC_WS_URL = process.env.EXPO_PUBLIC_WS_URL ?? 'https://ws.test.local';

// A hoisted holder the `socket.io-client` mock reads to build each fake socket.
// The test sets `create` per-run (in `beforeEach`) so it can capture the socket
// the production `ensureSocket()` ends up using for the connectivity-restore path.
const ioHarness = vi.hoisted(() => ({ create: null as null | (() => unknown) }));

// Stub the native boundary so the REAL socket module under test loads. These
// modules are imported transitively by `lib/socket.ts` but not exercised here.
vi.mock('expo-constants', () => ({ default: { expoConfig: { extra: {} } } }));
vi.mock('@react-native-community/netinfo', () => ({
  default: {
    fetch: () => Promise.resolve({ isConnected: true, isInternetReachable: true }),
    addEventListener: () => () => {},
  },
}));
vi.mock('react-native', () => ({
  AppState: { currentState: 'active', addEventListener: () => ({ remove: () => {} }) },
}));
vi.mock('socket.io-client', () => ({
  io: vi.fn(() => {
    if (!ioHarness.create) {
      throw new Error('socket.io-client `io` factory not configured for this test');
    }
    return ioHarness.create();
  }),
}));

import type { ConnectivityState } from '@/lib/connectivity';
import {
  type ConnectivitySource,
  disconnectSocket,
  initSocketReconnect,
  resubscribeAll,
  type Scheduler,
  subscribeRoom,
  subscribeTicket,
  unsubscribeRoom,
  unsubscribeTicket,
} from '@/lib/socket';
import { roomKey } from '@/lib/socket-registry';
import { createFakeSocket, type EmittedEvent, type FakeSocket } from '@/test-support';

/** Minimum fast-check iterations per property (design requires >= 100). */
const NUM_RUNS = 100;

// --- generators --------------------------------------------------------------

/** Non-empty identifier arbitrary for ticket ids, org ids and service ids. */
const idArb: fc.Arbitrary<string> = fc.string({ minLength: 1, maxLength: 12 });

/** Per-entry ref-count so the same entry can be subscribed multiple times. */
const refArb: fc.Arbitrary<number> = fc.integer({ min: 1, max: 3 });

interface TicketEntry {
  ticketId: string;
  orgId: string;
  refCount: number;
}

interface RoomEntry {
  orgId: string;
  serviceId?: string;
  refCount: number;
}

const ticketEntryArb: fc.Arbitrary<TicketEntry> = fc.record({
  ticketId: idArb,
  orgId: idArb,
  refCount: refArb,
});

const roomEntryArb: fc.Arbitrary<RoomEntry> = fc.record({
  orgId: idArb,
  // `fc.option` with non-empty `idArb` yields either `undefined` or a length>=1
  // string, so `{orgId}` and `{orgId, serviceId:''}` (which share a roomKey) can
  // never both be generated.
  serviceId: fc.option(idArb, { nil: undefined }),
  refCount: refArb,
});

/**
 * A full scenario: the entries that should remain TRACKED (each subscribed
 * `refCount` times) plus GHOST entries that are subscribed and then fully
 * unsubscribed (so they end up untracked). Tracked entries are unique by their
 * registry key (ticketId / roomKey); ghosts are unique among themselves AND
 * disjoint from the tracked keys, so the registry never merges a ghost into a
 * tracked entry.
 */
interface Scenario {
  trackedTickets: TicketEntry[];
  trackedRooms: RoomEntry[];
  ghostTickets: TicketEntry[];
  ghostRooms: RoomEntry[];
}

const scenarioArb: fc.Arbitrary<Scenario> = fc
  .record({
    trackedTickets: fc.uniqueArray(ticketEntryArb, {
      selector: (t) => t.ticketId,
      maxLength: 6,
    }),
    trackedRooms: fc.uniqueArray(roomEntryArb, {
      selector: (r) => roomKey(r),
      maxLength: 6,
    }),
  })
  .chain(({ trackedTickets, trackedRooms }) => {
    const takenTicketIds = new Set(trackedTickets.map((t) => t.ticketId));
    const takenRoomKeys = new Set(trackedRooms.map((r) => roomKey(r)));
    return fc.record({
      trackedTickets: fc.constant(trackedTickets),
      trackedRooms: fc.constant(trackedRooms),
      ghostTickets: fc.uniqueArray(
        ticketEntryArb.filter((t) => !takenTicketIds.has(t.ticketId)),
        { selector: (t) => t.ticketId, maxLength: 4 },
      ),
      ghostRooms: fc.uniqueArray(
        roomEntryArb.filter((r) => !takenRoomKeys.has(roomKey(r))),
        { selector: (r) => roomKey(r), maxLength: 4 },
      ),
    });
  });

// --- helpers -----------------------------------------------------------------

/**
 * Drive the production public subscribe API to bring the module-singleton
 * registry into the scenario's state: tracked entries are left subscribed,
 * ghosts are subscribed then fully unsubscribed. The session socket is created
 * lazily and is NOT connected during this phase, so no wire emits happen here —
 * the only emits we assert come from `resubscribeAll` / the reconnect path.
 */
function applyScenario(scenario: Scenario): void {
  for (const t of scenario.trackedTickets) {
    for (let i = 0; i < t.refCount; i += 1) {
      subscribeTicket(t.ticketId, t.orgId);
    }
  }
  for (const r of scenario.trackedRooms) {
    for (let i = 0; i < r.refCount; i += 1) {
      subscribeRoom({ orgId: r.orgId, serviceId: r.serviceId });
    }
  }
  for (const g of scenario.ghostTickets) {
    for (let i = 0; i < g.refCount; i += 1) {
      subscribeTicket(g.ticketId, g.orgId);
    }
    for (let i = 0; i < g.refCount; i += 1) {
      unsubscribeTicket(g.ticketId);
    }
  }
  for (const g of scenario.ghostRooms) {
    for (let i = 0; i < g.refCount; i += 1) {
      subscribeRoom({ orgId: g.orgId, serviceId: g.serviceId });
    }
    for (let i = 0; i < g.refCount; i += 1) {
      unsubscribeRoom({ orgId: g.orgId, serviceId: g.serviceId });
    }
  }
}

/** The exact set of emits a (re)connect must produce for a scenario's tracked set. */
function expectedEmits(scenario: Scenario): EmittedEvent[] {
  return [
    ...scenario.trackedTickets.map(
      (t): EmittedEvent => ({
        event: WS_EVENTS.SUBSCRIBE_TICKET,
        args: [{ ticketId: t.ticketId }],
      }),
    ),
    ...scenario.trackedRooms.map(
      (r): EmittedEvent => ({
        event: WS_EVENTS.SUBSCRIBE,
        args: [{ orgId: r.orgId, serviceId: r.serviceId }],
      }),
    ),
  ];
}

/** Order-insensitive serialization of recorded emits for set comparison. */
function serialize(emits: readonly EmittedEvent[]): string[] {
  return emits.map((e) => JSON.stringify({ event: e.event, args: e.args })).sort();
}

/** Assert the recorded emits are EXACTLY the scenario's tracked re-issue set. */
function assertExactlyTracked(emitted: readonly EmittedEvent[], scenario: Scenario): void {
  // Exactly the expected emits — no more, no fewer (order-insensitive).
  expect(serialize(emitted)).toStrictEqual(serialize(expectedEmits(scenario)));

  // One emit per tracked entry, and the total matches the tracked count.
  const ticketEmits = emitted.filter((e) => e.event === WS_EVENTS.SUBSCRIBE_TICKET);
  const roomEmits = emitted.filter((e) => e.event === WS_EVENTS.SUBSCRIBE);
  expect(ticketEmits).toHaveLength(scenario.trackedTickets.length);
  expect(roomEmits).toHaveLength(scenario.trackedRooms.length);
  expect(emitted).toHaveLength(scenario.trackedTickets.length + scenario.trackedRooms.length);

  // Nothing was re-issued for the ghost (untracked) entries.
  const ghostTicketIds = new Set(scenario.ghostTickets.map((g) => g.ticketId));
  for (const e of ticketEmits) {
    const ticketId = (e.args[0] as { ticketId: string }).ticketId;
    expect(ghostTicketIds.has(ticketId)).toBe(false);
  }
  const ghostRoomKeys = new Set(scenario.ghostRooms.map((g) => roomKey(g)));
  for (const e of roomEmits) {
    const arg = e.args[0] as { orgId: string; serviceId?: string };
    expect(ghostRoomKeys.has(roomKey(arg))).toBe(false);
  }
}

/** A connectivity store double exposing the `getState`/`subscribe` seam + a driver. */
interface FakeConnectivity extends ConnectivitySource {
  push: (patch: Partial<ConnectivityState>) => void;
}

function makeFakeConnectivity(initial: ConnectivityState): FakeConnectivity {
  let state = initial;
  const listeners = new Set<(state: ConnectivityState, prev: ConnectivityState) => void>();
  return {
    getState: () => state,
    subscribe: ((listener: (state: ConnectivityState, prev: ConnectivityState) => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    }) as ConnectivitySource['subscribe'],
    push: (patch) => {
      const prev = state;
      state = { ...state, ...patch };
      for (const listener of listeners) {
        listener(state, prev);
      }
    },
  };
}

const OFFLINE_STATE: ConnectivityState = {
  isOnline: false,
  appState: 'active',
  mayBeOutOfDate: true,
  liveActionsDisabled: true,
  liveActionDisabledReason: 'offline',
  setOnline: () => {},
  setAppState: () => {},
};

/** A no-op scheduler so the post-(re)connect verification window never fires real timers. */
const noopScheduler: Scheduler = {
  set: () => 0 as unknown as ReturnType<typeof setTimeout>,
  clear: () => {},
};

// --- test wiring -------------------------------------------------------------

/** The fake socket the faked `io()` most recently produced (the session socket). */
let sessionSocket: FakeSocket | null = null;

beforeEach(() => {
  sessionSocket = null;
  // Each `io()` call yields a fresh recording fake socket and remembers it as
  // the current session socket so the connectivity-restore test can inspect it.
  ioHarness.create = () => {
    sessionSocket = createFakeSocket();
    return sessionSocket.asSocket();
  };
});

afterEach(() => {
  // Full teardown: drops the session socket, disposes the reconnect controller,
  // and clears the module-singleton registry between runs.
  disconnectSocket();
  ioHarness.create = null;
});

// --- properties --------------------------------------------------------------

describe('Property 8: reconnect re-issues exactly the tracked subscriptions', () => {
  it('resubscribeAll re-emits exactly one subscribe/subscribe:ticket per tracked entry and none for untracked', () => {
    fc.assert(
      fc.property(scenarioArb, (scenario) => {
        // Fresh registry per run.
        disconnectSocket();

        applyScenario(scenario);

        // A (re)connect re-issues to the freshly-connected socket. Drive the real
        // re-issue function with the harness fake socket as the re-issue target.
        const reissueTarget = createFakeSocket();
        resubscribeAll(reissueTarget.asSocket());

        assertExactlyTracked(reissueTarget.emitted, scenario);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('a connectivity-restore (offline -> online) triggers the same exact re-emission (R9.3)', () => {
    fc.assert(
      fc.property(scenarioArb, (scenario) => {
        // Fresh registry per run, then wire the reconnect triggers to an injected
        // connectivity source starting OFFLINE (so the push to online is a real
        // transition) with a no-op scheduler (no real timers).
        disconnectSocket();
        const connectivity = makeFakeConnectivity({ ...OFFLINE_STATE });
        const teardown = initSocketReconnect({
          connectivity,
          scheduler: noopScheduler,
          ackWindowMs: 1_000,
        });

        try {
          applyScenario(scenario);
          // No emits during the (disconnected) subscribe phase.
          sessionSocket?.clearEmitted();

          // Connectivity restored -> the trigger funnels through the controller's
          // connect-and-resubscribe cycle, which re-issues every tracked entry.
          connectivity.push({
            isOnline: true,
            mayBeOutOfDate: false,
            liveActionsDisabled: false,
            liveActionDisabledReason: null,
          });

          expect(sessionSocket).not.toBeNull();
          assertExactlyTracked(sessionSocket?.emitted ?? [], scenario);
        } finally {
          teardown();
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });
});
