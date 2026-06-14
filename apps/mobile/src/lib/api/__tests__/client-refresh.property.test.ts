// Feature: customer-mobile-app, Property 21: Single-flight 401 refresh-and-retry is bounded
//
// Validates: Requirements 12.1, 12.3, 12.4
//
// For any authenticated request that receives a `401`, exactly ONE token
// refresh is performed and the original request is retried at most once with the
// refreshed token (R12.1/R12.3); concurrent `401`s share a single in-flight
// refresh (single-flight); and when the refresh fails, the stored tokens are
// cleared, the return-to-sign-in signal fires, and no further retry occurs
// (R12.4).
//
// The client is exercised through its injectable seams: `createApiClient` gets a
// recording fake `fetch` (driven by the generated scenario), an in-memory
// `TokenStore` seeded with a stale access/refresh token, an `onSessionInvalid`
// spy, and an explicit `baseUrl`. No live backend or device keychain is touched.
// The protected resource answers `401` while the request still carries the STALE
// access token and `200` once it carries the REFRESHED token, so the assertions
// can prove the retry actually used the new token. Refresh calls are counted by
// matching the refresh path among the recorded fetches.
import fc from 'fast-check';
import { describe, expect, it, vi } from 'vitest';

// `createApiClient` statically pulls in `@/lib/env` (→ `expo-constants`) and
// `@/lib/auth/secure-store` (→ `expo-secure-store`). Those native packages ship
// Flow-typed source Vitest's transform cannot parse, and they are never
// exercised by this property (the client gets an injected `baseUrl`, mock
// `TokenStore`, and `onSessionInvalid`). Stub the native boundary so the REAL
// client logic under test loads; nothing about the refresh behavior is faked.
vi.mock('expo-constants', () => ({ default: { expoConfig: { extra: {} } } }));
vi.mock('expo-secure-store', () => ({
  getItemAsync: vi.fn(),
  setItemAsync: vi.fn(),
  deleteItemAsync: vi.fn(),
}));

import { ApiError, createApiClient } from '@/lib/api/client';
import {
  createFakeFetch,
  createMockTokenStore,
  errorResponse,
  successResponse,
  type FetchCall,
} from '@/test-support';

const BASE_URL = 'https://api.test.local/api/v1';
// The default refresh path the client posts to (R12). We do NOT inject a custom
// refreshPath so the real default is exercised, and we count refresh calls by
// matching this segment in the recorded fetch URLs.
const REFRESH_PATH = '/customers/refresh';
// A protected resource path that does NOT contain the refresh segment, so the
// refresh-call count is unambiguous.
const RESOURCE_PATH = '/account/data';

// --- arbitraries -----------------------------------------------------------

/** Header-safe, non-empty token values (hex keeps `Authorization` well-formed). */
const tokenArb: fc.Arbitrary<string> = fc
  .hexaString({ minLength: 4, maxLength: 24 })
  .map((s) => `tok_${s}`);

/** A pair of guaranteed-distinct tokens (stale vs refreshed). */
const distinctTokenPairArb: fc.Arbitrary<[string, string]> = fc
  .tuple(tokenArb, tokenArb)
  .map(([a, b]) => (a === b ? [a, `${a}_next`] : [a, b]));

/** JSON-serializable payload returned by the protected resource on the retry. */
const payloadArb: fc.Arbitrary<unknown> = fc.jsonValue();

/** A refresh failure: a non-OK HTTP status (incl. 404/501 while not deployed) or a network drop. */
const refreshFailureArb: fc.Arbitrary<{ mode: 'status'; status: number } | { mode: 'network' }> =
  fc.oneof(
    fc
      .constantFrom(400, 401, 403, 404, 500, 501, 503)
      .map((status): { mode: 'status'; status: number } => ({ mode: 'status', status })),
    fc.constant<{ mode: 'network' }>({ mode: 'network' }),
  );

type Scenario =
  // (a) one authenticated request: 401 → refresh-success → retry once with new token.
  | {
      kind: 'single-success';
      staleAccess: string;
      staleRefresh: string;
      newAccess: string;
      newRefresh: string;
      payload: unknown;
    }
  // (c) N concurrent authenticated requests, all hitting 401 → ONE shared refresh.
  | {
      kind: 'concurrent-success';
      count: number;
      staleAccess: string;
      staleRefresh: string;
      newAccess: string;
      newRefresh: string;
      payload: unknown;
    }
  // (b) 401 → refresh-failure → tokens cleared, onSessionInvalid fires, no retry.
  | {
      kind: 'refresh-failure';
      staleAccess: string;
      staleRefresh: string;
      failure: { mode: 'status'; status: number } | { mode: 'network' };
    };

const scenarioArb: fc.Arbitrary<Scenario> = fc.oneof(
  fc
    .record({
      tokens: distinctTokenPairArb,
      newRefresh: tokenArb,
      staleRefresh: tokenArb,
      payload: payloadArb,
    })
    .map(
      ({ tokens, newRefresh, staleRefresh, payload }): Scenario => ({
        kind: 'single-success',
        staleAccess: tokens[0],
        newAccess: tokens[1],
        staleRefresh,
        newRefresh,
        payload,
      }),
    ),
  fc
    .record({
      count: fc.integer({ min: 2, max: 8 }),
      tokens: distinctTokenPairArb,
      newRefresh: tokenArb,
      staleRefresh: tokenArb,
      payload: payloadArb,
    })
    .map(
      ({ count, tokens, newRefresh, staleRefresh, payload }): Scenario => ({
        kind: 'concurrent-success',
        count,
        staleAccess: tokens[0],
        newAccess: tokens[1],
        staleRefresh,
        newRefresh,
        payload,
      }),
    ),
  fc.record({ staleAccess: tokenArb, staleRefresh: tokenArb, failure: refreshFailureArb }).map(
    ({ staleAccess, staleRefresh, failure }): Scenario => ({
      kind: 'refresh-failure',
      staleAccess,
      staleRefresh,
      failure,
    }),
  ),
);

/** JSON round-trip — the exact transform the payload undergoes through the Response. */
const roundTrip = (value: unknown): unknown => JSON.parse(JSON.stringify(value));

/** Count fetches that targeted the refresh endpoint. */
const refreshCallCount = (calls: readonly FetchCall[]): number =>
  calls.filter((c) => c.url.includes(REFRESH_PATH)).length;

/** Count fetches that targeted the protected resource (initial + any retry). */
const resourceCallCount = (calls: readonly FetchCall[]): number =>
  calls.filter((c) => c.url.includes(RESOURCE_PATH)).length;

// --- property --------------------------------------------------------------

describe('Property 21: Single-flight 401 refresh-and-retry is bounded', () => {
  it('performs exactly one refresh per 401 cycle, retries once with the refreshed token, shares a single in-flight refresh across concurrent 401s, and on failure clears tokens + signals sign-in without retrying', async () => {
    await fc.assert(
      fc.asyncProperty(scenarioArb, async (scenario) => {
        const onSessionInvalid = vi.fn();

        if (scenario.kind === 'refresh-failure') {
          const tokenStore = createMockTokenStore({
            accessToken: scenario.staleAccess,
            refreshToken: scenario.staleRefresh,
          });
          const fakeFetch = createFakeFetch((call): Response => {
            if (call.url.includes(REFRESH_PATH)) {
              if (scenario.failure.mode === 'network') {
                throw new Error('network down');
              }
              return errorResponse(
                'AUTH_TOKEN_EXPIRED',
                'expired',
                undefined,
                scenario.failure.status,
              );
            }
            // Protected resource: the only token it ever sees is the stale one
            // (no successful refresh happens), so it always answers 401.
            return errorResponse('AUTH_UNAUTHORIZED', 'unauthorized', undefined, 401);
          });

          const client = createApiClient({
            fetchFn: fakeFetch.fetch,
            tokenStore,
            onSessionInvalid,
            baseUrl: BASE_URL,
          });

          let thrown: unknown;
          let returned: unknown;
          try {
            returned = await client.get<unknown>(RESOURCE_PATH, { authenticated: true });
          } catch (error) {
            thrown = error;
          }

          // R12.4: the original request fails (no data leaks through).
          expect(returned).toBeUndefined();
          expect(thrown).toBeInstanceOf(ApiError);
          // Exactly one refresh attempt was made (single-flight, no looping).
          expect(refreshCallCount(fakeFetch.calls)).toBe(1);
          // No second retry of the original request: it was sent exactly once.
          expect(resourceCallCount(fakeFetch.calls)).toBe(1);
          // R12.4: stored tokens cleared and the return-to-sign-in signal fired once.
          expect(tokenStore.calls.clear).toBeGreaterThanOrEqual(1);
          expect(tokenStore.current.accessToken).toBeNull();
          expect(tokenStore.current.refreshToken).toBeNull();
          expect(onSessionInvalid).toHaveBeenCalledTimes(1);
          return;
        }

        // success scenarios (single + concurrent) share a responder: the resource
        // returns 401 while the request still carries the STALE access token, and
        // 200 once it carries the REFRESHED token — proving the retry used it.
        const { staleAccess, staleRefresh, newAccess, newRefresh, payload } = scenario;
        const tokenStore = createMockTokenStore({
          accessToken: staleAccess,
          refreshToken: staleRefresh,
        });
        const fakeFetch = createFakeFetch((call): Response => {
          if (call.url.includes(REFRESH_PATH)) {
            return successResponse({
              tokens: { accessToken: newAccess, refreshToken: newRefresh },
            });
          }
          const auth = call.headers.get('Authorization');
          if (auth === `Bearer ${newAccess}`) {
            return successResponse(payload);
          }
          // Stale (or missing) token → 401, which triggers the refresh-and-retry.
          return errorResponse('AUTH_UNAUTHORIZED', 'unauthorized', undefined, 401);
        });

        const client = createApiClient({
          fetchFn: fakeFetch.fetch,
          tokenStore,
          onSessionInvalid,
          baseUrl: BASE_URL,
        });

        const count = scenario.kind === 'concurrent-success' ? scenario.count : 1;

        // Fire all requests concurrently so the single-flight slot is genuinely contended.
        const results = await Promise.all(
          Array.from({ length: count }, () =>
            client.get<unknown>(RESOURCE_PATH, { authenticated: true }),
          ),
        );

        // R12.3 single-flight: regardless of how many concurrent 401s occurred,
        // EXACTLY ONE refresh was performed.
        expect(refreshCallCount(fakeFetch.calls)).toBe(1);

        // R12.1: each original request is retried at most once — initial + retry = 2 per request.
        expect(resourceCallCount(fakeFetch.calls)).toBe(count * 2);

        // Tokens were replaced with the refreshed pair (exactly one set).
        expect(tokenStore.calls.set).toBe(1);
        expect(tokenStore.current.accessToken).toBe(newAccess);
        expect(tokenStore.current.refreshToken).toBe(newRefresh);

        // The successful (retried) requests all carried the refreshed token.
        const refreshedResourceCalls = fakeFetch.calls.filter(
          (c) =>
            c.url.includes(RESOURCE_PATH) &&
            c.headers.get('Authorization') === `Bearer ${newAccess}`,
        );
        expect(refreshedResourceCalls).toHaveLength(count);

        // Every request resolved with the unwrapped payload; no sign-out occurred.
        for (const result of results) {
          expect(result.data).toEqual(roundTrip(payload));
        }
        expect(onSessionInvalid).not.toHaveBeenCalled();
      }),
      { numRuns: 100 },
    );
  });
});
