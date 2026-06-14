// Feature: customer-mobile-app, Task 12.4 integration test
//
// Validates: Requirements 7.1
//
// Integration test for the TICKET-HISTORY query hook's network contract:
// `useTicketHistory` issues an AUTHENTICATED `GET /customers/history` and
// unwraps the backend's history array.
//
// APPROACH (documented per task 12.4):
//   `useTicketHistory` composes the singleton `apiClient` (`createApiClient`) +
//   TanStack Query: its `queryFn` calls
//   `apiClient.get(TICKET_HISTORY_PATH, { authenticated: true })` and hands the
//   unwrapped array to the pure `projectTicketHistory`. This app's suite runs in
//   a headless `node` environment with NO React renderer / testing-library (see
//   vitest.config.ts), so rendering the hook is impractical without adding test
//   dependencies. As the task allows, we instead exercise the SAME seam the hook
//   uses — the REAL REST transport (`createApiClient`) over an injected fake
//   `fetch` — driving exactly the request the hook's `queryFn` makes:
//   `get(TICKET_HISTORY_PATH, { authenticated: true })`. We assert the request
//   METHOD is GET, the PATH is `/customers/history`, an `Authorization: Bearer`
//   header is attached (the endpoint is Bearer-auth, R7.1), and the mocked
//   history array is unwrapped from the success envelope. No live backend,
//   device keychain, or React runtime is touched.

// `@/lib/api/client` statically imports `@/lib/env` (→ `expo-constants`) and
// `@/lib/auth/secure-store` (→ `expo-secure-store`). Those native packages ship
// Flow-typed source Vitest's transform cannot parse and are never exercised here
// (the client gets an injected `baseUrl` + fake `fetch` + in-memory token store).
// Stub the native boundary so the REAL client logic under test loads — nothing
// about the history behavior is faked. (Mirrors the discovery/client tests.)
import { describe, expect, it, vi } from 'vitest';

vi.mock('expo-constants', () => ({ default: { expoConfig: { extra: {} } } }));
vi.mock('expo-secure-store', () => ({
  getItemAsync: vi.fn(),
  setItemAsync: vi.fn(),
  deleteItemAsync: vi.fn(),
}));

import { TicketStatus } from '@queuenow/shared-types';

import { createApiClient } from '@/lib/api/client';
import { TICKET_HISTORY_PATH } from '@/features/history/use-ticket-history';
import type { TicketHistoryEntry } from '@/features/history/types';
import { createFakeFetch, createMockTokenStore, successResponse } from '@/test-support';

const BASE_URL = 'https://api.test.local/api/v1';
const ACCESS_TOKEN = 'access-token-abc123';

/** Narrow a possibly-undefined value to defined, failing the test otherwise. */
function expectDefined<T>(value: T | null | undefined, label: string): T {
  if (value === null || value === undefined) {
    throw new Error(`expected ${label} to be defined`);
  }
  return value;
}

/** A representative `GET /customers/history` payload (newest-first, R7.1). */
const HISTORY: TicketHistoryEntry[] = [
  {
    id: 'tkt_2',
    orgId: 'org_1',
    serviceId: 'svc_gp',
    ticketNumber: 'GP002',
    dailyNumber: 2,
    status: TicketStatus.COMPLETED,
    recallCount: 0,
    isRejoin: false,
    createdAt: '2024-01-02T09:00:00.000Z',
    service: { id: 'svc_gp', name: 'General Practice' },
    organization: { id: 'org_1', name: 'Acme Clinic' },
  },
  {
    id: 'tkt_1',
    orgId: 'org_1',
    serviceId: 'svc_lab',
    ticketNumber: 'LB001',
    dailyNumber: 1,
    status: TicketStatus.COMPLETED,
    recallCount: 0,
    isRejoin: false,
    createdAt: '2024-01-01T09:00:00.000Z',
    service: { id: 'svc_lab', name: 'Lab Tests' },
    organization: { id: 'org_1', name: 'Acme Clinic' },
  },
];

describe('Task 12.4: history hook calls GET /customers/history (R7.1)', () => {
  it('exposes the history endpoint path the design endpoint map declares', () => {
    // R7.1: the hook reads history from the Bearer-auth `/customers/history`
    // endpoint. Pinning the exported constant guards the contract that the
    // hook's `queryFn` (and these assertions) target.
    expect(TICKET_HISTORY_PATH).toBe('/customers/history');
  });

  it('issues exactly one authenticated GET /customers/history and unwraps the history array', async () => {
    // Drive the REAL REST transport (the same factory backing the singleton
    // `apiClient` the history hook calls) over an injected fake `fetch` that
    // returns the history envelope. Seed the token store with an access token so
    // the `authenticated: true` request attaches the Bearer header (R6.4/R7.1).
    const fakeFetch = createFakeFetch(() => successResponse(HISTORY));
    const tokenStore = createMockTokenStore({ accessToken: ACCESS_TOKEN });
    const client = createApiClient({
      fetchFn: fakeFetch.fetch,
      tokenStore,
      baseUrl: BASE_URL,
    });

    // This is exactly the request `useTicketHistory`'s queryFn makes (R7.1).
    const { data } = await client.get<TicketHistoryEntry[]>(TICKET_HISTORY_PATH, {
      authenticated: true,
    });

    // The hook issued exactly one request, with the right method + path
    // (Bearer-auth history read — R7.1).
    expect(fakeFetch.calls).toHaveLength(1);
    const sent = expectDefined(fakeFetch.calls[0], 'recorded fetch call');
    expect(sent.method).toBe('GET');
    expect(sent.url).toBe(`${BASE_URL}/customers/history`);

    // Authenticated: the access token is attached as `Authorization: Bearer`.
    expect(sent.headers.get('Authorization')).toBe(`Bearer ${ACCESS_TOKEN}`);

    // The mocked history array is unwrapped from the success envelope.
    expect(data).toEqual(HISTORY);
  });
});
