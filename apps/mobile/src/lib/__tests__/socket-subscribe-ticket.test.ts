// Feature: customer-mobile-app, Task 9.4 integration test
//
// Validates: Requirements 4.1
//
// Integration test for the subscribe-on-view behavior the active-ticket screen
// (`app/ticket/[orgId]/[ticketId].tsx`) triggers on mount: it calls the
// Realtime_Client's `subscribeTicket(ticketId, orgId)`, which lazily opens the
// single `socket.io-client` connection on the `/queue` namespace and, once the
// transport connects, emits exactly one `subscribe:ticket` (WS_EVENTS.
// SUBSCRIBE_TICKET) carrying `{ ticketId }` for the Active_Ticket (R4.1).
//
// Unlike the pure-logic property tests, this drives the REAL production socket
// module end-to-end against a MOCK socket: the faked `socket.io-client` `io()`
// returns the boundary harness fake-socket (`src/test-support`), which records
// every outgoing emit and lets us simulate the transport `connect`. We assert
// the connection target namespace (`/queue`) and the exact `subscribe:ticket`
// wire emit produced for the tracked ticket.
//
// `lib/socket.ts` statically pulls in expo / react-native native modules through
// its dependency graph (`@/lib/env` → `expo-constants`; `@/lib/connectivity` →
// `@react-native-community/netinfo` + `react-native` `AppState`; the
// `socket.io-client` transport). None of those are exercised by this test, so we
// stub the native boundary (the same stubs the socket property tests use) and
// seed the public env vars, so the REAL socket module under test loads and runs;
// only the transport `io()` is faked.
import { WS_EVENTS } from '@queuenow/shared-constants';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Seed the public env so `@/lib/env` validation passes when `ensureSocket()`
// reads `env.EXPO_PUBLIC_WS_URL` (no live URL is ever contacted — `io` is faked).
process.env.EXPO_PUBLIC_API_URL =
  process.env.EXPO_PUBLIC_API_URL ?? 'https://api.test.local/api/v1';
process.env.EXPO_PUBLIC_WS_URL = process.env.EXPO_PUBLIC_WS_URL ?? 'https://ws.test.local';

// A hoisted holder the `socket.io-client` mock reads to build each fake socket.
// The test sets `create` per-run (in `beforeEach`) so it can capture the socket
// the production `ensureSocket()` ends up using as the session connection.
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

import { io } from 'socket.io-client';

import { disconnectSocket, subscribeTicket } from '@/lib/socket';
import { createFakeSocket, type FakeSocket } from '@/test-support';

/** Identifiers for the Active_Ticket under view (the ticket-screen route params). */
const TICKET_ID = 'tk_active_42';
const ORG_ID = 'org_demo';

/** The fake socket the faked `io()` produced (the session/`/queue` connection). */
let sessionSocket: FakeSocket | null = null;

beforeEach(() => {
  sessionSocket = null;
  vi.mocked(io).mockClear();
  // Each `io()` call yields a fresh recording fake socket and remembers it as the
  // current session socket so the test can simulate `connect` and inspect emits.
  ioHarness.create = () => {
    sessionSocket = createFakeSocket();
    return sessionSocket.asSocket();
  };
});

afterEach(() => {
  // Full teardown: drops the session socket, disposes the reconnect controller,
  // and clears the module-singleton registry between tests for isolation.
  disconnectSocket();
  ioHarness.create = null;
});

describe('Task 9.4: socket subscribe-on-view integration (R4.1)', () => {
  it('connects to the /queue namespace and emits exactly one subscribe:ticket for the Active_Ticket on connect', () => {
    // The ticket screen mounts and subscribes to the Active_Ticket's live updates.
    subscribeTicket(TICKET_ID, ORG_ID);

    // The Realtime_Client lazily opened the single connection on `/queue`.
    expect(io).toHaveBeenCalledTimes(1);
    const connectUrl = vi.mocked(io).mock.calls[0]?.[0] as string;
    expect(connectUrl.endsWith('/queue')).toBe(true);
    expect(sessionSocket).not.toBeNull();

    // Before the transport connects, no wire emit has happened — the subscription
    // is recorded and (re)issued on the next `connect` (R4.1/R4.4).
    expect(sessionSocket?.emitsFor(WS_EVENTS.SUBSCRIBE_TICKET)).toHaveLength(0);

    // Simulate the transport connecting (the mock socket dispatches `connect`).
    sessionSocket?.connect();

    // Exactly one `subscribe:ticket` was emitted, carrying the Active_Ticket id.
    const subscribeEmits = sessionSocket?.emitsFor(WS_EVENTS.SUBSCRIBE_TICKET) ?? [];
    expect(subscribeEmits).toHaveLength(1);
    expect(subscribeEmits[0]?.args).toStrictEqual([{ ticketId: TICKET_ID }]);

    // The subscribe:ticket is the only thing the view's mount put on the wire.
    expect(sessionSocket?.emitted).toStrictEqual([
      { event: WS_EVENTS.SUBSCRIBE_TICKET, args: [{ ticketId: TICKET_ID }] },
    ]);
  });

  it('subscribes the ticket only once even when the screen subscribes repeatedly (ref-counted)', () => {
    // Repeated mounts/subscribers for the same Active_Ticket collapse to one
    // wire subscription (the ref-counted registry keys by ticketId).
    subscribeTicket(TICKET_ID, ORG_ID);
    subscribeTicket(TICKET_ID, ORG_ID);

    expect(io).toHaveBeenCalledTimes(1);

    sessionSocket?.connect();

    expect(sessionSocket?.emitsFor(WS_EVENTS.SUBSCRIBE_TICKET)).toHaveLength(1);
    expect(sessionSocket?.emitsFor(WS_EVENTS.SUBSCRIBE_TICKET)[0]?.args).toStrictEqual([
      { ticketId: TICKET_ID },
    ]);
  });
});
