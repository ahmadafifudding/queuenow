// Feature: customer-mobile-app, Task 7.4 example test
//
// Validates: Requirements 1.2
//
// Example (input-invariant) test for the MANUAL-CODE discovery happy path:
// a customer types an organization code, the app resolves the org through the
// public queue-status endpoint, and the active services flow through to a
// "join is available" decision.
//
// APPROACH (documented per task 7.4):
//   The screen wires `manualDiscoveryTarget` (pure) → `resolveOrgIdentifier`
//   (pure) → the `useOrgStatus`/`useDiscovery` TanStack Query hooks (which call
//   the singleton `apiClient.get('/organizations/:orgId/queue/status')`) →
//   `normalizeServices` + `joinAvailability` (pure). This app's test suite runs
//   in a headless `node` environment with NO React renderer / testing-library
//   (see vitest.config.ts), so rendering the hook is impractical without adding
//   test dependencies. As the task allows, we instead exercise the SAME path at
//   two real seams:
//     1. the PURE discovery functions the hook composes
//        (`manualDiscoveryTarget`, `resolveOrgIdentifier`, `normalizeServices`,
//        `joinAvailability`), and
//     2. the REAL REST transport the hook's query function uses, by driving an
//        `apiClient` built from `createApiClient` over an injected fake `fetch`
//        (the production `apiClient` singleton uses this exact `createApiClient`
//        factory + `apiClient.get`). We assert the request METHOD is GET, the
//        PATH is `/organizations/:orgId/queue/status`, and the unwrapped
//        response yields the org's active services.
//   No live backend, device keychain, or React runtime is touched.

// `@/lib/api/client` statically imports `@/lib/env` (→ `expo-constants`) and
// `@/lib/auth/secure-store` (→ `expo-secure-store`). Those native packages ship
// Flow-typed source Vitest's transform cannot parse and are never exercised here
// (the client gets an injected `baseUrl` + fake `fetch` + in-memory token store).
// Stub the native boundary so the REAL client logic under test loads — nothing
// about the discovery behavior is faked. (Mirrors the client property tests.)
import { describe, expect, it, vi } from 'vitest';

vi.mock('expo-constants', () => ({ default: { expoConfig: { extra: {} } } }));
vi.mock('expo-secure-store', () => ({
  getItemAsync: vi.fn(),
  setItemAsync: vi.fn(),
  deleteItemAsync: vi.fn(),
}));

import { createApiClient } from '@/lib/api/client';
import { joinAvailability, normalizeServices } from '@/features/discovery/join-availability';
import {
  manualDiscoveryTarget,
  resolveOrgIdentifier,
} from '@/features/discovery/parse-discovery-url';
import type { OrgQueueStatus } from '@/features/discovery/types';
import { createFakeFetch, createMockTokenStore, successResponse } from '@/test-support';

const BASE_URL = 'https://api.test.local/api/v1';

/** Narrow a possibly-undefined value to defined, failing the test otherwise. */
function expectDefined<T>(value: T | null | undefined, label: string): T {
  if (value === null || value === undefined) {
    throw new Error(`expected ${label} to be defined`);
  }
  return value;
}

/** A representative public queue-status payload for an active org (R1.2). */
const ORG_STATUS: OrgQueueStatus = {
  organizationId: 'org_123',
  organizationName: 'Acme Clinic',
  services: [
    {
      service: { id: 'svc_gp', name: 'General Practice', prefix: 'GP' },
      waiting: 4,
      serving: 1,
      estimatedWaitMinutes: 20,
    },
    {
      service: { id: 'svc_lab', name: 'Lab Tests', prefix: 'LB' },
      waiting: 2,
      serving: 0,
      estimatedWaitMinutes: 10,
    },
  ],
  lastUpdated: '2024-01-01T09:00:00.000Z',
};

describe('Task 7.4: manual-code discovery happy path (R1.2)', () => {
  it('parses a valid manual code into a manual discovery target', () => {
    // R1.2: a manually entered organization code yields a `manual` target whose
    // slug is the (trimmed) code; this is the org identifier the status query
    // is scoped to.
    expect(manualDiscoveryTarget('acme-clinic')).toEqual({
      slug: 'acme-clinic',
      source: 'manual',
    });

    // Surrounding whitespace is trimmed (the customer's typed input is cleaned).
    expect(manualDiscoveryTarget('  acme-clinic  ')).toEqual({
      slug: 'acme-clinic',
      source: 'manual',
    });
  });

  it('returns null for empty / blank manual codes (no resolution attempted)', () => {
    // R1.2: blank input is not a code — it must not resolve to a target (and so
    // no status request is ever attempted).
    expect(manualDiscoveryTarget('')).toBeNull();
    expect(manualDiscoveryTarget('   ')).toBeNull();
    // A non-string defensive guard also yields null rather than throwing.
    expect(manualDiscoveryTarget(undefined as unknown as string)).toBeNull();
  });

  it('resolves the org and returns its active services via GET /organizations/:orgId/queue/status', async () => {
    // 1. The customer types a code → manual target.
    const target = expectDefined(manualDiscoveryTarget('acme-clinic'), 'manual target');

    // 2. The target resolves to the org identifier the status endpoint is scoped to.
    const orgId = resolveOrgIdentifier(target);
    expect(orgId).toBe('acme-clinic');

    // 3. Drive the REAL REST transport (the same factory backing the singleton
    //    `apiClient` the discovery hook calls) over an injected fake `fetch`
    //    that returns the public status envelope.
    const fakeFetch = createFakeFetch(() => successResponse(ORG_STATUS));
    const client = createApiClient({
      fetchFn: fakeFetch.fetch,
      tokenStore: createMockTokenStore(),
      baseUrl: BASE_URL,
    });

    const { data } = await client.get<OrgQueueStatus>(`/organizations/${orgId}/queue/status`);

    // The discovery query issued exactly one request, with the right method+path
    // (public, org-id-scoped status read — R1.2).
    expect(fakeFetch.calls).toHaveLength(1);
    const sent = expectDefined(fakeFetch.calls[0], 'recorded fetch call');
    expect(sent.method).toBe('GET');
    expect(sent.url).toBe(`${BASE_URL}/organizations/acme-clinic/queue/status`);
    // Public endpoint → no Authorization header attached.
    expect(sent.headers.has('Authorization')).toBe(false);

    // The mocked response is unwrapped to the org status (name + active services).
    expect(data.organizationName).toBe('Acme Clinic');

    // 4. The active services flow through the pure decision the screen renders:
    //    a join action IS presented, all active services are returned, and with
    //    more than one service explicit selection is required (R1.2/R1.4).
    const decision = joinAvailability({ services: normalizeServices(data) });
    expect(decision.presentJoinAction).toBe(true);
    expect(decision.showError).toBe(false);
    expect(decision.services.map((s) => s.id)).toEqual(['svc_gp', 'svc_lab']);
    expect(decision.requiresServiceSelection).toBe(true);
    expect(decision.preselectedServiceId).toBeNull();
  });

  it('auto-selects the only service when a resolved org exposes exactly one', async () => {
    // Single-service happy path: the join action is presented and the lone
    // service is preselected (no selection step needed) — R1.2/R1.4.
    const singleServiceStatus: OrgQueueStatus = {
      ...ORG_STATUS,
      services: [expectDefined(ORG_STATUS.services[0], 'first service')],
    };

    const fakeFetch = createFakeFetch(() => successResponse(singleServiceStatus));
    const client = createApiClient({
      fetchFn: fakeFetch.fetch,
      tokenStore: createMockTokenStore(),
      baseUrl: BASE_URL,
    });

    const orgId = resolveOrgIdentifier(
      expectDefined(manualDiscoveryTarget('acme-clinic'), 'manual target'),
    );
    const { data } = await client.get<OrgQueueStatus>(`/organizations/${orgId}/queue/status`);

    const sent = expectDefined(fakeFetch.calls[0], 'recorded fetch call');
    expect(sent.method).toBe('GET');
    expect(sent.url).toBe(`${BASE_URL}/organizations/acme-clinic/queue/status`);

    const decision = joinAvailability({ services: normalizeServices(data) });
    expect(decision.presentJoinAction).toBe(true);
    expect(decision.requiresServiceSelection).toBe(false);
    expect(decision.preselectedServiceId).toBe('svc_gp');
  });
});
