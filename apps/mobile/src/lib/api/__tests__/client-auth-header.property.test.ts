// Feature: customer-mobile-app, Property 15: Authenticated requests attach the Bearer token or fail closed
//
// Validates: Requirements 6.4, 6.5
//
// For any request the client reads the access token before sending (R6.4).
//   - When a token is present the built request headers include
//     `Authorization: Bearer <token>` — for BOTH authenticated and
//     non-authenticated requests (R6.4).
//   - When the request is marked `authenticated` and the token cannot be
//     obtained (the store returns `null` OR the read throws), the client FAILS
//     CLOSED: it throws an `ApiError` and NO network send occurs — the request
//     is never sent without the token (R6.5).
//   - When the request is NOT authenticated and no token is available, the
//     request still proceeds token-less: `fetch` IS called and the headers carry
//     no `Authorization` header (R6.4).
//
// The client is exercised through its injectable seams: `createApiClient` gets
// a recording fake `fetch` (records whether it was called + the headers it
// received) and an in-memory `TokenStore` whose token can be present, `null`,
// or made to throw on read, plus an explicit `baseUrl` so importing the module
// never forces env validation. No live backend or device keychain is touched.
import { ERROR_CODES } from '@queuenow/shared-constants';
import fc from 'fast-check';
import { describe, expect, it, vi } from 'vitest';

// `createApiClient` statically pulls in `@/lib/env` (→ `expo-constants`) and
// `@/lib/auth/secure-store` (→ `expo-secure-store`). Those native packages ship
// Flow-typed source that Vitest's transform cannot parse, and they are never
// exercised by this property (the client gets an injected `baseUrl` + mock
// `TokenStore`). Stub the native boundary so the REAL client logic under test
// loads; nothing about the auth-header behavior is faked.
vi.mock('expo-constants', () => ({ default: { expoConfig: { extra: {} } } }));
vi.mock('expo-secure-store', () => ({
  getItemAsync: vi.fn(),
  setItemAsync: vi.fn(),
  deleteItemAsync: vi.fn(),
}));

import { ApiError, createApiClient } from '@/lib/api/client';
import { createFakeFetch, createMockTokenStore, successResponse } from '@/test-support';

const BASE_URL = 'https://api.test.local/api/v1';

// --- arbitraries -----------------------------------------------------------

// A non-empty access-token string. Constrained to URL-safe base64 characters —
// the realistic shape of a JWT/access token — because header VALUES are trimmed
// of surrounding whitespace by the `Headers` API, so a token with leading/
// trailing whitespace could never survive a round-trip through any HTTP header
// (this is a transport invariant, not the auth-attach logic under test).
const tokenArb: fc.Arbitrary<string> = fc
  .stringMatching(/^[A-Za-z0-9._-]+$/)
  .filter((s) => s.length > 0)
  .map((s) => `tok_${s}`);

/** How the token store behaves for the access token on this run. */
type TokenState = { kind: 'present'; token: string } | { kind: 'null' } | { kind: 'throw' };

const tokenStateArb: fc.Arbitrary<TokenState> = fc.oneof(
  tokenArb.map((token): TokenState => ({ kind: 'present', token })),
  fc.constant<TokenState>({ kind: 'null' }),
  fc.constant<TokenState>({ kind: 'throw' }),
);

/** A request path to hit (irrelevant to the property; varied for generality). */
const pathArb: fc.Arbitrary<string> = fc
  .webSegment()
  .filter((s) => s.length > 0)
  .map((s) => `/${s}`);

interface Scenario {
  authenticated: boolean;
  token: TokenState;
  path: string;
}

const scenarioArb: fc.Arbitrary<Scenario> = fc.record({
  authenticated: fc.boolean(),
  token: tokenStateArb,
  path: pathArb,
});

function buildTokenStore(state: TokenState) {
  switch (state.kind) {
    case 'present':
      return createMockTokenStore({ accessToken: state.token });
    case 'null':
      return createMockTokenStore({ accessToken: null });
    case 'throw':
      return createMockTokenStore({ failGetAccessToken: true });
  }
}

// --- property --------------------------------------------------------------

describe('Property 15: Authenticated requests attach the Bearer token or fail closed', () => {
  it('attaches Bearer when a token is present, fails closed (no send) for authenticated requests without a token, and proceeds token-less for unauthenticated requests', async () => {
    await fc.assert(
      fc.asyncProperty(scenarioArb, async (scenario) => {
        const fakeFetch = createFakeFetch(() => successResponse({ ok: true }));
        const tokenStore = buildTokenStore(scenario.token);
        const client = createApiClient({
          fetchFn: fakeFetch.fetch,
          tokenStore,
          baseUrl: BASE_URL,
        });

        const tokenAvailable = scenario.token.kind === 'present';

        let thrown: unknown;
        try {
          await client.get<unknown>(scenario.path, { authenticated: scenario.authenticated });
        } catch (error) {
          thrown = error;
        }

        if (scenario.authenticated && !tokenAvailable) {
          // R6.5 fail-closed: an authenticated request with no obtainable token
          // throws an ApiError and is NEVER sent — no network call occurred.
          expect(thrown).toBeInstanceOf(ApiError);
          expect(fakeFetch.calls).toHaveLength(0);
          return;
        }

        // Every other branch sends exactly one request and does not throw at the
        // auth-header stage.
        expect(thrown).toBeUndefined();
        expect(fakeFetch.calls).toHaveLength(1);

        const sent = fakeFetch.calls[0];
        if (!sent) {
          throw new Error('expected exactly one recorded fetch call');
        }
        if (tokenAvailable) {
          // R6.4: a present token is attached as `Authorization: Bearer <token>`
          // regardless of whether the request was marked authenticated.
          const token = (scenario.token as { kind: 'present'; token: string }).token;
          expect(sent.headers.get('Authorization')).toBe(`Bearer ${token}`);
        } else {
          // R6.4: an unauthenticated request with no token proceeds token-less —
          // no Authorization header is attached.
          expect(sent.headers.has('Authorization')).toBe(false);
        }
      }),
      { numRuns: 100 },
    );
  });

  it('keeps INTERNAL/auth error codes well-formed on the fail-closed throw', async () => {
    // Spot-check the fail-closed ApiError carries the auth code (R6.5) so the
    // UI maps it to the "sign in" copy rather than a generic failure.
    const tokenStore = createMockTokenStore({ accessToken: null });
    const fakeFetch = createFakeFetch(() => successResponse({ ok: true }));
    const client = createApiClient({
      fetchFn: fakeFetch.fetch,
      tokenStore,
      baseUrl: BASE_URL,
    });

    await expect(client.get('/secure', { authenticated: true })).rejects.toMatchObject({
      code: ERROR_CODES.AUTH_UNAUTHORIZED,
    });
    expect(fakeFetch.calls).toHaveLength(0);
  });
});
