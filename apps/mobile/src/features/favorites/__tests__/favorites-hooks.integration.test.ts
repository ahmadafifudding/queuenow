// Feature: customer-mobile-app, Task 13.2 integration test
//
// Validates: Requirements 8.1, 8.2, 8.3
//
// Integration test for the favorites list / add / remove flow. It asserts that
// the three favorites hooks issue the exact authenticated REST calls the design
// endpoint map specifies (design "Endpoint map"):
//   - useFavorites      → GET    /customers/favorites            (R8.1)
//   - useAddFavorite    → POST   /customers/favorites/:orgId     (R8.2)
//   - useRemoveFavorite → DELETE /customers/favorites/:orgId     (R8.3)
// all carrying `Authorization: Bearer <token>` (Bearer-auth rows in the map).
//
// APPROACH (mirrors the manual-discovery integration test, task 7.4):
//   This app's suite runs in a headless `node` environment with NO React
//   renderer / testing-library (see vitest.config.ts), so rendering the
//   TanStack Query hooks to invoke their query/mutation functions is
//   impractical without adding test dependencies. As task 13.2 allows, we drive
//   the SAME REST transport the hooks' query/mutation functions use — the
//   `createApiClient` factory that backs the singleton `apiClient` the hooks
//   call (`api.get`/`api.post`/`api.delete`) — over an injected fake `fetch`,
//   and assert the METHOD, PATH, and Authorization header recorded for each.
//   The calls below replicate, byte-for-byte, the paths/methods/`authenticated`
//   flag from `use-favorites.ts` (`FAVORITES_PATH` and `favoritePath`).
//   No live backend, device keychain, or React runtime is touched.

// `@/lib/api/client` statically imports `@/lib/env` (→ `expo-constants`) and
// `@/lib/auth/secure-store` (→ `expo-secure-store`). Those native packages ship
// Flow-typed source Vitest's transform cannot parse and are never exercised here
// (the client gets an injected `baseUrl` + fake `fetch` + in-memory token store).
// Stub the native boundary so the REAL client logic under test loads.
import { describe, expect, it, vi } from 'vitest';

vi.mock('expo-constants', () => ({ default: { expoConfig: { extra: {} } } }));
vi.mock('expo-secure-store', () => ({
  getItemAsync: vi.fn(),
  setItemAsync: vi.fn(),
  deleteItemAsync: vi.fn(),
}));

import { createApiClient } from '@/lib/api/client';
import { createFakeFetch, createMockTokenStore, successResponse } from '@/test-support';

import type { FavoriteItem } from '../types';

const BASE_URL = 'https://api.test.local/api/v1';
const ACCESS_TOKEN = 'access-token-abc123';

// Paths replicated verbatim from `use-favorites.ts` (kept private there, so we
// reproduce the exact contract the hooks depend on).
const FAVORITES_PATH = '/customers/favorites';
const favoritePath = (orgId: string): string => `${FAVORITES_PATH}/${encodeURIComponent(orgId)}`;

/** Narrow a possibly-undefined value to defined, failing the test otherwise. */
function expectDefined<T>(value: T | null | undefined, label: string): T {
  if (value === null || value === undefined) {
    throw new Error(`expected ${label} to be defined`);
  }
  return value;
}

/** A representative favorites payload (`GET /customers/favorites`, R8.1). */
const FAVORITES: FavoriteItem[] = [
  {
    id: 'fav_1',
    orgId: 'org_123',
    createdAt: '2024-01-02T10:00:00.000Z',
    organization: {
      id: 'org_123',
      name: 'Acme Clinic',
      slug: 'acme-clinic',
      type: 'CLINIC',
      address: '1 Main St',
    } as FavoriteItem['organization'],
  },
];

describe('Task 13.2: favorites list/add/remove issue the correct authenticated REST calls', () => {
  it('useFavorites reads GET /customers/favorites with a Bearer token (R8.1)', async () => {
    // The `useFavorites` queryFn does exactly: api.get(FAVORITES_PATH, { authenticated: true }).
    const fakeFetch = createFakeFetch(() => successResponse(FAVORITES));
    const client = createApiClient({
      fetchFn: fakeFetch.fetch,
      tokenStore: createMockTokenStore({ accessToken: ACCESS_TOKEN }),
      baseUrl: BASE_URL,
    });

    const { data } = await client.get<FavoriteItem[]>(FAVORITES_PATH, { authenticated: true });

    expect(fakeFetch.calls).toHaveLength(1);
    const sent = expectDefined(fakeFetch.calls[0], 'recorded fetch call');
    expect(sent.method).toBe('GET');
    expect(sent.url).toBe(`${BASE_URL}/customers/favorites`);
    expect(sent.headers.get('Authorization')).toBe(`Bearer ${ACCESS_TOKEN}`);

    // The success envelope is unwrapped to the favorites list.
    expect(data).toEqual(FAVORITES);
  });

  it('useAddFavorite posts to /customers/favorites/:orgId with a Bearer token (R8.2)', async () => {
    // The `useAddFavorite` mutationFn does exactly:
    //   api.post(favoritePath(orgId), undefined, { authenticated: true }).
    const orgId = 'org_123';
    const fakeFetch = createFakeFetch(() => successResponse({ id: 'fav_1', orgId }));
    const client = createApiClient({
      fetchFn: fakeFetch.fetch,
      tokenStore: createMockTokenStore({ accessToken: ACCESS_TOKEN }),
      baseUrl: BASE_URL,
    });

    await client.post<unknown>(favoritePath(orgId), undefined, { authenticated: true });

    expect(fakeFetch.calls).toHaveLength(1);
    const sent = expectDefined(fakeFetch.calls[0], 'recorded fetch call');
    expect(sent.method).toBe('POST');
    expect(sent.url).toBe(`${BASE_URL}/customers/favorites/org_123`);
    expect(sent.headers.get('Authorization')).toBe(`Bearer ${ACCESS_TOKEN}`);
  });

  it('useRemoveFavorite deletes /customers/favorites/:orgId with a Bearer token (R8.3)', async () => {
    // The `useRemoveFavorite` mutationFn does exactly:
    //   api.delete(favoritePath(orgId), { authenticated: true }).
    const orgId = 'org_123';
    const fakeFetch = createFakeFetch(() => successResponse({ removed: true }));
    const client = createApiClient({
      fetchFn: fakeFetch.fetch,
      tokenStore: createMockTokenStore({ accessToken: ACCESS_TOKEN }),
      baseUrl: BASE_URL,
    });

    await client.delete<unknown>(favoritePath(orgId), { authenticated: true });

    expect(fakeFetch.calls).toHaveLength(1);
    const sent = expectDefined(fakeFetch.calls[0], 'recorded fetch call');
    expect(sent.method).toBe('DELETE');
    expect(sent.url).toBe(`${BASE_URL}/customers/favorites/org_123`);
    expect(sent.headers.get('Authorization')).toBe(`Bearer ${ACCESS_TOKEN}`);
  });

  it('encodes an orgId with reserved characters into the add/remove path (R8.2, R8.3)', async () => {
    // The hook builds the path via `encodeURIComponent(orgId)`, so reserved
    // characters in an orgId must be percent-encoded into a single path segment
    // (never split into extra segments or query string).
    const orgId = 'org/with space&weird?id=1';
    const encoded = 'org%2Fwith%20space%26weird%3Fid%3D1';
    expect(favoritePath(orgId)).toBe(`/customers/favorites/${encoded}`);

    // POST (add) carries the encoded segment.
    const addFetch = createFakeFetch(() => successResponse({ ok: true }));
    const addClient = createApiClient({
      fetchFn: addFetch.fetch,
      tokenStore: createMockTokenStore({ accessToken: ACCESS_TOKEN }),
      baseUrl: BASE_URL,
    });
    await addClient.post<unknown>(favoritePath(orgId), undefined, { authenticated: true });
    const addSent = expectDefined(addFetch.calls[0], 'recorded add fetch call');
    expect(addSent.method).toBe('POST');
    expect(addSent.url).toBe(`${BASE_URL}/customers/favorites/${encoded}`);
    expect(addSent.headers.get('Authorization')).toBe(`Bearer ${ACCESS_TOKEN}`);

    // DELETE (remove) carries the identical encoded segment.
    const removeFetch = createFakeFetch(() => successResponse({ ok: true }));
    const removeClient = createApiClient({
      fetchFn: removeFetch.fetch,
      tokenStore: createMockTokenStore({ accessToken: ACCESS_TOKEN }),
      baseUrl: BASE_URL,
    });
    await removeClient.delete<unknown>(favoritePath(orgId), { authenticated: true });
    const removeSent = expectDefined(removeFetch.calls[0], 'recorded remove fetch call');
    expect(removeSent.method).toBe('DELETE');
    expect(removeSent.url).toBe(`${BASE_URL}/customers/favorites/${encoded}`);
    expect(removeSent.headers.get('Authorization')).toBe(`Bearer ${ACCESS_TOKEN}`);
  });

  it('fails closed (no request sent) when an authenticated favorites call has no token (R8.1)', async () => {
    // The favorites calls are `authenticated`, so the client must throw and
    // NOT hit the network when no token is available — account-scoped data is
    // never requested without a session.
    const fakeFetch = createFakeFetch(() => successResponse(FAVORITES));
    const client = createApiClient({
      fetchFn: fakeFetch.fetch,
      tokenStore: createMockTokenStore({ accessToken: null }),
      baseUrl: BASE_URL,
    });

    await expect(
      client.get<FavoriteItem[]>(FAVORITES_PATH, { authenticated: true }),
    ).rejects.toMatchObject({ code: 'AUTH_UNAUTHORIZED' });
    expect(fakeFetch.calls).toHaveLength(0);
  });
});
