// Feature: customer-mobile-app, Task 9.3 example test
//
// Validates: Requirements 3.2
//
// Example (input-invariant) test for the TICKET-VIEW fetch happy path:
// opening the active-ticket view (`ticket/[orgId]/[ticketId].tsx`) reads the
// tracked ticket through the shared `apiClient` on the public ticket-status
// endpoint `GET /organizations/:orgId/queue/ticket/:ticketId` (R3.2), and the
// envelope is unwrapped into the `TicketStatusView` the screen renders.
//
// APPROACH (documented per task 9.3):
//   The screen wires `useTicketStatus(orgId, ticketId)` (TanStack Query) → the
//   singleton `apiClient.get(ticketStatusPath(orgId, ticketId))`. This app's
//   test suite runs in a headless `node` environment with NO React renderer /
//   testing-library (see vitest.config.ts), so rendering the hook is impractical
//   without adding test dependencies. As the task allows, we instead exercise
//   the SAME query path at two real seams:
//     1. the PURE path builder the hook composes (`ticketStatusPath`), asserting
//        it produces the exact public ticket-status path, and
//     2. the REAL REST transport the hook's query function uses, by driving an
//        `apiClient` built from `createApiClient` over an injected fake `fetch`
//        (the production `apiClient` singleton uses this exact `createApiClient`
//        factory + `apiClient.get`). We assert the request METHOD is GET, the
//        PATH is `/organizations/:orgId/queue/ticket/:ticketId`, and the
//        unwrapped response yields the tracked ticket.
//   No live backend, device keychain, or React runtime is touched.

// `@/lib/api/client` statically imports `@/lib/env` (→ `expo-constants`) and
// `@/lib/auth/secure-store` (→ `expo-secure-store`). Those native packages ship
// Flow-typed source Vitest's transform cannot parse and are never exercised here
// (the client gets an injected `baseUrl` + fake `fetch` + in-memory token store).
// Stub the native boundary so the REAL client logic under test loads — nothing
// about the ticket-view fetch behavior is faked. (Mirrors the discovery example
// + client property tests.)
import { describe, expect, it, vi } from 'vitest';

vi.mock('expo-constants', () => ({ default: { expoConfig: { extra: {} } } }));
vi.mock('expo-secure-store', () => ({
  getItemAsync: vi.fn(),
  setItemAsync: vi.fn(),
  deleteItemAsync: vi.fn(),
}));

import { TicketStatus } from '@queuenow/shared-types';

import { createApiClient } from '@/lib/api/client';
import { ticketStatusPath } from '@/features/queue/use-ticket-status';
import type { TicketStatusView } from '@/lib/view-models';
import { createFakeFetch, createMockTokenStore, successResponse } from '@/test-support';

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

describe('Task 9.3: ticket-view fetch happy path (R3.2)', () => {
  it('builds the public ticket-status path the view query targets', () => {
    // R3.2: the ticket view reads `GET /organizations/:orgId/queue/ticket/:ticketId`.
    // `ticketStatusPath` is the single source of that path (the hook calls
    // `apiClient.get(ticketStatusPath(orgId, ticketId))`).
    expect(ticketStatusPath(ORG_ID, TICKET_ID)).toBe(
      `/organizations/${ORG_ID}/queue/ticket/${TICKET_ID}`,
    );
  });

  it('URL-encodes the org and ticket ids in the path', () => {
    // Defensive: ids carrying reserved characters are encoded so the path stays
    // well-formed (the hook passes ids straight through to `ticketStatusPath`).
    expect(ticketStatusPath('org a/b', 'tkt?1')).toBe(
      '/organizations/org%20a%2Fb/queue/ticket/tkt%3F1',
    );
  });

  it('opening the ticket view issues exactly one GET to /organizations/:orgId/queue/ticket/:ticketId and unwraps the ticket', async () => {
    // Drive the REAL REST transport (the same factory backing the singleton
    // `apiClient` the ticket-status hook calls) over an injected fake `fetch`
    // that returns the ticket-status envelope.
    const fakeFetch = createFakeFetch(() => successResponse(TICKET_STATUS));
    const client = createApiClient({
      fetchFn: fakeFetch.fetch,
      tokenStore: createMockTokenStore(),
      baseUrl: BASE_URL,
    });

    // This is exactly what `useTicketStatus`'s queryFn runs on mount.
    const { data } = await client.get<TicketStatusView>(ticketStatusPath(ORG_ID, TICKET_ID));

    // The view's query issued exactly one request, with the right method + path
    // (public, org+ticket-scoped status read — R3.2).
    expect(fakeFetch.calls).toHaveLength(1);
    const sent = expectDefined(fakeFetch.calls[0], 'recorded fetch call');
    expect(sent.method).toBe('GET');
    expect(sent.url).toBe(`${BASE_URL}/organizations/${ORG_ID}/queue/ticket/${TICKET_ID}`);
    // Public endpoint → no Authorization header attached.
    expect(sent.headers.has('Authorization')).toBe(false);

    // The mocked response is unwrapped into the tracked ticket the screen renders.
    expect(data.id).toBe(TICKET_ID);
    expect(data.orgId).toBe(ORG_ID);
    expect(data.ticketNumber).toBe('GP-007');
    expect(data.status).toBe(TicketStatus.WAITING);
    // Position/wait are surfaced verbatim from the backend (no client offset).
    expect(data.position).toBe(3);
    expect(data.estimatedWaitMinutes).toBe(15);
  });
});
