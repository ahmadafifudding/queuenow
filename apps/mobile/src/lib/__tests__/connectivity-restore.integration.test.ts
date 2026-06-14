// Feature: customer-mobile-app, Task 20.3 integration test
//
// Validates: Requirements 9.3, 9.4
//
// Integration tests for the OFFLINE → ONLINE restore behavior and the manual
// pull-to-refresh of the Active_Ticket. Two requirement angles are covered:
//
//  - R9.3 (connectivity restore): when the device comes back online the ticket
//    REFETCHES via REST and the Realtime_Client RE-ESTABLISHES subscriptions.
//  - R9.4 (manual refresh): a manual pull-to-refresh refetches the ticket via
//    REST.
//
// APPROACH (documented per task 20.3):
//   The active-ticket screen composes `useActiveTicket`, whose connectivity
//   restore effect calls `query.refetch()` on the offline→online transition
//   (R9.3) and whose `refresh()` (pull-to-refresh) calls the same
//   `query.refetch()` (R9.4); app-wide, task 20.1 also bridges the connectivity
//   store into TanStack Query's `onlineManager`. The realtime re-subscription is
//   driven by the socket reconnect controller, which the connectivity bridge
//   triggers on restore.
//
//   This app's suite runs in a headless `node` environment with NO React
//   renderer / testing-library (see vitest.config.ts), so mounting the full hook
//   is impractical without adding test dependencies. As the task allows, we
//   exercise the SAME production seams the hook composes, choosing the most
//   faithful achievable assertion for each behavior:
//
//     1. RE-SUBSCRIBE ON RESTORE (R9.3): wire the REAL `initSocketReconnect`
//        with an injected connectivity source starting OFFLINE + a fake socket,
//        subscribe a ticket, then push offline→online and assert the tracked
//        subscription is re-issued (`subscribe:ticket` re-emitted). This is the
//        exact path the connectivity bridge funnels a restore through.
//     2. GATING FLIPS ON RESTORE (R9.3): drive the REAL connectivity store
//        offline→online and assert it flips the live-action gating
//        (`liveActionsDisabled` false, staleness cleared). This is the signal
//        the hook's restore effect / the screen's live actions key on.
//     3. REFETCH ON RESTORE (R9.3) and MANUAL REFRESH (R9.4): drive the REAL
//        REST transport (`createApiClient`) + a real `QueryClient` on the REAL
//        `queryKeys.ticket` key, and assert that the `refetch` path the hook's
//        restore effect (R9.3) and `refresh()` (R9.4) both invoke issues another
//        GET to `/organizations/:orgId/queue/ticket/:ticketId`.
//
//   No live backend, device keychain, real socket, or React runtime is touched.
//
// `@/lib/socket` + `@/lib/connectivity` + `@/lib/api/client` statically pull in
// native packages (`expo-constants`, `expo-secure-store`,
// `@react-native-community/netinfo`, `react-native`'s `AppState`, the
// `socket.io-client` transport). None are exercised here — the wiring under test
// is pure / dependency-injected — so we stub the native boundary (mirroring the
// reconnect-resubscribe + client integration tests) to let the REAL modules
// load; nothing about the restore/refresh behavior is faked.
import { WS_EVENTS } from '@queuenow/shared-constants';
import { TicketStatus } from '@queuenow/shared-types';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Seed the public env so `@/lib/env` validation passes when `ensureSocket()`
// reads `env.EXPO_PUBLIC_WS_URL` (no live URL is ever contacted — `io` is faked).
process.env.EXPO_PUBLIC_API_URL =
  process.env.EXPO_PUBLIC_API_URL ?? 'https://api.test.local/api/v1';
process.env.EXPO_PUBLIC_WS_URL = process.env.EXPO_PUBLIC_WS_URL ?? 'https://ws.test.local';

// A hoisted holder the faked `socket.io-client` reads to build each fake socket;
// the test sets `create` per-run so it can capture the session socket the
// production `ensureSocket()` ends up driving for the restore path.
const ioHarness = vi.hoisted(() => ({ create: null as null | (() => unknown) }));

vi.mock('expo-constants', () => ({ default: { expoConfig: { extra: {} } } }));
vi.mock('expo-secure-store', () => ({
  getItemAsync: vi.fn(),
  setItemAsync: vi.fn(),
  deleteItemAsync: vi.fn(),
}));
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

import { createApiClient } from '@/lib/api/client';
import { queryKeys } from '@/lib/api/query-keys';
import { ticketStatusPath } from '@/features/queue/use-ticket-status';
import {
  connectivityStore,
  useConnectivityStore,
  type ConnectivityState,
} from '@/lib/connectivity';
import {
  disconnectSocket,
  initSocketReconnect,
  subscribeTicket,
  type ConnectivitySource,
  type Scheduler,
} from '@/lib/socket';
import type { TicketStatusView } from '@/lib/view-models';
import {
  createFakeFetch,
  createFakeSocket,
  createMockTokenStore,
  createTestQueryClient,
  successResponse,
  type FakeSocket,
} from '@/test-support';

const BASE_URL = 'https://api.test.local/api/v1';
const ORG_ID = 'org_123';
const TICKET_ID = 'tkt_456';

/** Narrow a possibly-undefined value to defined, failing the test otherwise. */
function expectDefined<T>(value: T | null | undefined, label: string): T {
  if (value === null || value === undefined) {
    throw new Error(`expected ${label} to be defined`);
  }
  return value;
}

/** A representative ticket-status payload for a WAITING ticket (R3.2). */
const TICKET_STATUS: TicketStatusView = {
  id: TICKET_ID,
  orgId: ORG_ID,
  serviceId: 'svc_gp',
  counterId: null,
  ticketNumber: 'GP-007',
  dailyNumber: 7,
  status: TicketStatus.WAITING,
  customerName: 'Sam Customer',
  customerPhone: null,
  customerProfileId: null,
  calledAt: null,
  completedAt: null,
  skippedAt: null,
  recallCount: 0,
  isRejoin: false,
  createdAt: '2024-01-01T09:00:00.000Z',
  position: 3,
  estimatedWaitMinutes: 15,
  counter: null,
  service: { id: 'svc_gp', name: 'General Practice', prefix: 'GP', avgServingTime: 5 },
};

// --- connectivity-source fake (drives the socket reconnect triggers) ---------

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

// --- query-layer harness -----------------------------------------------------

/** Build a REAL apiClient over a recording fake `fetch` that returns the ticket. */
function makeTicketTransport(): {
  fakeFetch: ReturnType<typeof createFakeFetch>;
  client: ReturnType<typeof createApiClient>;
} {
  const fakeFetch = createFakeFetch(() => successResponse(TICKET_STATUS));
  const client = createApiClient({
    fetchFn: fakeFetch.fetch,
    tokenStore: createMockTokenStore(),
    baseUrl: BASE_URL,
  });
  return { fakeFetch, client };
}

/** Recorded GETs to the public ticket-status endpoint (the query's network calls). */
function ticketGets(
  fakeFetch: ReturnType<typeof createFakeFetch>,
): ReturnType<typeof createFakeFetch>['calls'] {
  const expectedUrl = `${BASE_URL}/organizations/${ORG_ID}/queue/ticket/${TICKET_ID}`;
  return fakeFetch.calls.filter((call) => call.url === expectedUrl && call.method === 'GET');
}

// --- test wiring -------------------------------------------------------------

/** The fake socket the faked `io()` most recently produced (the session socket). */
let sessionSocket: FakeSocket | null = null;

beforeEach(() => {
  sessionSocket = null;
  ioHarness.create = () => {
    sessionSocket = createFakeSocket();
    return sessionSocket.asSocket();
  };
});

afterEach(() => {
  // Full socket teardown (drops the session socket + disposes the controller +
  // clears the module-singleton registry), and restore the real connectivity
  // store to online so suites never leak offline state.
  disconnectSocket();
  ioHarness.create = null;
  useConnectivityStore.getState().setOnline(true);
});

// --- R9.3: connectivity restore re-establishes subscriptions -----------------

describe('connectivity restore → realtime re-subscription (R9.3)', () => {
  it('re-issues the tracked ticket subscription when the device comes back online', () => {
    // Wire the REAL reconnect controller to an injected connectivity source that
    // starts OFFLINE (so the push to online is a real transition), with a no-op
    // scheduler so no real timers fire during the ack window.
    const connectivity = makeFakeConnectivity({ ...OFFLINE_STATE });
    const teardown = initSocketReconnect({
      connectivity,
      scheduler: noopScheduler,
      ackWindowMs: 1_000,
    });

    try {
      // Track the Active_Ticket while offline; the lazily-created socket is not
      // connected yet, so nothing is emitted during the subscribe phase.
      subscribeTicket(TICKET_ID, ORG_ID);
      sessionSocket?.clearEmitted();

      // Connectivity restored → the trigger funnels through the controller's
      // connect-and-resubscribe cycle, which re-issues every tracked entry (R9.3).
      connectivity.push({
        isOnline: true,
        mayBeOutOfDate: false,
        liveActionsDisabled: false,
        liveActionDisabledReason: null,
      });

      const socket = expectDefined(sessionSocket, 'session socket');
      const subscribeEmits = socket.emitsFor(WS_EVENTS.SUBSCRIBE_TICKET);

      // Exactly one re-issued `subscribe:ticket` carrying the tracked ticket id.
      expect(subscribeEmits).toHaveLength(1);
      expect(subscribeEmits[0]?.args[0]).toEqual({ ticketId: TICKET_ID });
    } finally {
      teardown();
    }
  });
});

// --- R9.3: connectivity restore flips the live-action gating -----------------

describe('connectivity restore → live-action gating (R9.3)', () => {
  it('flips liveActionsDisabled false and clears staleness when restored', () => {
    const store = useConnectivityStore.getState();

    // Go offline: live actions (incl. the live refresh) are disabled with a
    // stated reason and cached data is flagged as possibly out of date (R9.2).
    store.setOnline(false);
    const offline = useConnectivityStore.getState();
    expect(offline.liveActionsDisabled).toBe(true);
    expect(offline.mayBeOutOfDate).toBe(true);
    expect(offline.liveActionDisabledReason).not.toBeNull();

    // Restore connectivity: gating clears, re-enabling the live refresh the
    // restore effect / pull-to-refresh perform (R9.3) — and staleness clears.
    store.setOnline(true);
    const online = useConnectivityStore.getState();
    expect(online.liveActionsDisabled).toBe(false);
    expect(online.mayBeOutOfDate).toBe(false);
    expect(online.liveActionDisabledReason).toBeNull();

    // The shared non-hook accessor reads the same restored state.
    expect(connectivityStore.getState().isOnline).toBe(true);
  });
});

// --- R9.3 / R9.4: the refetch path issues another GET to the ticket endpoint -

describe('ticket refetch path issues another GET (R9.3 restore, R9.4 manual refresh)', () => {
  it('connectivity-restore refetch re-reads the ticket via REST (R9.3)', async () => {
    // The hook's restore effect runs `query.refetch()` on offline→online. Drive
    // the SAME query layer: a real QueryClient on the real `queryKeys.ticket`
    // key, whose queryFn is exactly what `useTicketStatus` runs.
    const { fakeFetch, client } = makeTicketTransport();
    const queryClient = createTestQueryClient();
    const queryKey = queryKeys.ticket(ORG_ID, TICKET_ID);
    const queryFn = async (): Promise<TicketStatusView> => {
      const { data } = await client.get<TicketStatusView>(ticketStatusPath(ORG_ID, TICKET_ID));
      return data;
    };

    try {
      // Initial load (e.g. opening the screen while online): one GET.
      await queryClient.fetchQuery({ queryKey, queryFn });
      expect(ticketGets(fakeFetch)).toHaveLength(1);

      // Connectivity restored → `useActiveTicket`'s restore effect refetches the
      // ticket key; the refetch issues a second GET to the public endpoint.
      await queryClient.refetchQueries({ queryKey, type: 'all' });
      expect(ticketGets(fakeFetch)).toHaveLength(2);

      // The refetched data is the ticket-status the screen re-renders from.
      const refreshed = queryClient.getQueryData<TicketStatusView>(queryKey);
      expect(expectDefined(refreshed, 'refetched ticket').id).toBe(TICKET_ID);
    } finally {
      queryClient.clear();
    }
  });

  it('manual pull-to-refresh re-reads the ticket via REST (R9.4)', async () => {
    // `useActiveTicket.refresh()` (pull-to-refresh) calls the same
    // `query.refetch()`. Assert it issues another GET to the ticket endpoint.
    const { fakeFetch, client } = makeTicketTransport();
    const queryClient = createTestQueryClient();
    const queryKey = queryKeys.ticket(ORG_ID, TICKET_ID);
    const queryFn = async (): Promise<TicketStatusView> => {
      const { data } = await client.get<TicketStatusView>(ticketStatusPath(ORG_ID, TICKET_ID));
      return data;
    };

    try {
      // Initial load: one GET to the public ticket-status endpoint.
      await queryClient.fetchQuery({ queryKey, queryFn });
      const first = ticketGets(fakeFetch);
      expect(first).toHaveLength(1);
      expect(expectDefined(first[0], 'initial GET').url).toBe(
        `${BASE_URL}/organizations/${ORG_ID}/queue/ticket/${TICKET_ID}`,
      );

      // Pull-to-refresh → refetch → a second GET to the same endpoint (R9.4).
      await queryClient.refetchQueries({ queryKey, type: 'all' });
      const after = ticketGets(fakeFetch);
      expect(after).toHaveLength(2);
      expect(after.every((call) => call.method === 'GET')).toBe(true);
    } finally {
      queryClient.clear();
    }
  });
});
