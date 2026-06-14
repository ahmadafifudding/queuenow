// Property tests for the API_Client (lib/api/client.ts).
//
// Validates: Requirements 2.3, 2.4, 2.5, 2.6, 4.6
//
// These properties exercise the client at the `fetch` boundary: we stub global
// `fetch` per generated case so we can return synthetic success/error envelopes
// and 401s, and COUNT calls (refresh + retry). Env is stubbed once so the base
// URL is deterministic; the Auth_Store is reset between cases.
//
// fast-check + Vitest, minimum 100 runs per property.
import type { ILoginResponse } from '@queuenow/shared-types';
import { UserRoleType } from '@queuenow/shared-types';
import fc from 'fast-check';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { useAuthStore } from '@/features/auth/stores/auth-store';
import { ApiError, request } from '@/lib/api/client';

const API_BASE = 'http://localhost:4000/api/v1';

// ---------------------------------------------------------------------------
// Test doubles
// ---------------------------------------------------------------------------

/** Build a minimal `Response`-like object the client can consume. */
function makeResponse(status: number, body: unknown): Response {
  return {
    status,
    ok: status >= 200 && status < 300,
    json: async (): Promise<unknown> => body,
  } as unknown as Response;
}

/** A well-formed login/session envelope used so the refresh flow can succeed. */
const validSession: ILoginResponse = {
  user: { id: 'u1', email: 'staff@example.com', fullName: 'Staff Member', avatarUrl: null },
  organization: { id: 'org1', name: 'Acme', slug: 'acme', role: UserRoleType.STAFF },
  tokens: { accessToken: 'refreshed-access-token', refreshToken: 'ignored-by-frontend' },
};

beforeAll(() => {
  // Deterministic base URL + ws url so the lazily-validated `env` proxy passes.
  vi.stubEnv('VITE_API_URL', API_BASE);
  vi.stubEnv('VITE_WS_URL', 'http://localhost:4000');
});

beforeEach(() => {
  // Reset session between cases so token state is controlled per property.
  useAuthStore.getState().clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

// ---------------------------------------------------------------------------
// Property 1
// ---------------------------------------------------------------------------

describe('Property 1: Success envelope unwrapping preserves data and meta', () => {
  // Feature: web-app, Property 1: Success envelope unwrapping preserves data and meta
  // Validates: Requirements 2.4, 2.5

  /** Pagination meta: each of page/limit/total is an optional non-negative int. */
  const metaArb = fc.option(
    fc.record(
      {
        page: fc.nat({ max: 100_000 }),
        limit: fc.nat({ max: 100_000 }),
        total: fc.nat({ max: 100_000 }),
      },
      { requiredKeys: [] },
    ),
    { nil: undefined },
  );

  it('returns data unchanged and exposes the same meta', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.jsonValue(),
        metaArb,
        async (data: unknown, meta: Record<string, number> | undefined) => {
          useAuthStore.getState().clear();
          const envelope =
            meta === undefined ? { success: true, data } : { success: true, data, meta };
          vi.stubGlobal(
            'fetch',
            vi.fn(async () => makeResponse(200, envelope)),
          );

          const result = await request<unknown>('/anything');

          expect(result.data).toEqual(data);
          expect(result.meta).toEqual(meta);
        },
      ),
      { numRuns: 100 },
    );
  });
});

// ---------------------------------------------------------------------------
// Property 2
// ---------------------------------------------------------------------------

describe('Property 2: Error envelope surfaces the error code', () => {
  // Feature: web-app, Property 2: Error envelope surfaces the error code
  // Validates: Requirements 2.6

  /** A backend error code is a non-empty token string. */
  const codeArb = fc
    .array(fc.constantFrom(...'ABCDEFGHIJKLMNOPQRSTUVWXYZ_0123456789'.split('')), {
      minLength: 1,
      maxLength: 40,
    })
    .map((chars) => chars.join(''));

  const detailsArb = fc.option(
    fc.dictionary(
      fc
        .array(fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz'.split('')), {
          minLength: 1,
          maxLength: 12,
        })
        .map((c) => c.join('')),
      fc.string(),
    ),
    { nil: undefined },
  );

  it('rejects with an ApiError carrying the same code and preserved details', async () => {
    await fc.assert(
      fc.asyncProperty(
        codeArb,
        fc.string(),
        detailsArb,
        fc.constantFrom(400, 409, 422, 403),
        async (
          code: string,
          message: string,
          details: Record<string, string> | undefined,
          status: number,
        ) => {
          useAuthStore.getState().clear();
          const envelope = { success: false, error: { code, message, details } };
          vi.stubGlobal(
            'fetch',
            vi.fn(async () => makeResponse(status, envelope)),
          );

          let thrown: unknown;
          try {
            await request<unknown>('/anything');
          } catch (error) {
            thrown = error;
          }

          expect(thrown).toBeInstanceOf(ApiError);
          const apiError = thrown as ApiError;
          expect(apiError.code).toBe(code);
          expect(apiError.details).toEqual(details);
          expect(apiError.httpStatus).toBe(status);
        },
      ),
      { numRuns: 100 },
    );
  });
});

// ---------------------------------------------------------------------------
// Property 3
// ---------------------------------------------------------------------------

describe('Property 3: Authenticated requests attach the in-memory token', () => {
  // Feature: web-app, Property 3: Authenticated requests attach the in-memory token
  // Validates: Requirements 2.3

  /** Token chars restricted to a header-safe set (avoid Headers throwing). */
  const tokenChar = fc.constantFrom(
    ...'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~'.split(''),
  );
  const nonEmptyTokenArb = fc
    .array(tokenChar, { minLength: 1, maxLength: 64 })
    .map((chars) => chars.join(''));
  // Either a non-empty token string, or null (no token).
  const tokenStateArb = fc.option(nonEmptyTokenArb, { nil: null });

  it('sends Authorization: Bearer <token> iff a token is present', async () => {
    await fc.assert(
      fc.asyncProperty(tokenStateArb, async (token: string | null) => {
        useAuthStore.getState().clear();
        if (token !== null) {
          useAuthStore.getState().setAccessToken(token);
        }

        let capturedInit: RequestInit | undefined;
        const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
          capturedInit = init;
          return makeResponse(200, { success: true, data: { ok: true } });
        });
        vi.stubGlobal('fetch', fetchMock);

        await request<unknown>('/anything');

        expect(fetchMock).toHaveBeenCalledTimes(1);
        const headers = new Headers(capturedInit?.headers);
        if (token === null) {
          expect(headers.has('Authorization')).toBe(false);
        } else {
          expect(headers.get('Authorization')).toBe(`Bearer ${token}`);
        }
      }),
      { numRuns: 100 },
    );
  });
});

// ---------------------------------------------------------------------------
// Property 5
// ---------------------------------------------------------------------------

describe('Property 5: A 401 triggers at most one refresh and one retry', () => {
  // Feature: web-app, Property 5: A 401 triggers at most one refresh and one retry
  // Validates: Requirements 4.6

  it('shares a single refresh across concurrent 401s and retries each request once', async () => {
    await fc.assert(
      fc.asyncProperty(fc.integer({ min: 1, max: 8 }), async (n: number) => {
        useAuthStore.getState().clear();

        const callCounts = new Map<string, number>();
        let refreshCount = 0;

        const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
          const url = String(input);
          if (url.endsWith('/auth/refresh')) {
            refreshCount += 1;
            return makeResponse(200, { success: true, data: validSession });
          }
          const prior = callCounts.get(url) ?? 0;
          callCounts.set(url, prior + 1);
          // First hit on a path → 401; the retry (second hit) → success.
          if (prior === 0) {
            return makeResponse(401, {
              success: false,
              error: { code: 'AUTH_UNAUTHORIZED', message: 'unauthorized' },
            });
          }
          return makeResponse(200, { success: true, data: { path: url } });
        });
        vi.stubGlobal('fetch', fetchMock);

        const paths = Array.from({ length: n }, (_, i) => `/resource-${i}`);
        const results = await Promise.all(paths.map((p) => request<unknown>(p)));

        // Every request ultimately resolves (no unbounded loop / no rejection).
        expect(results).toHaveLength(n);
        for (const result of results) {
          expect(result.data).toBeDefined();
        }

        // Single-flight: at most one refresh per cycle (exactly one here).
        expect(refreshCount).toBeLessThanOrEqual(1);
        expect(refreshCount).toBe(1);

        // Each original request is retried at most once → exactly 2 hits/path
        // (the initial 401 + the single retry); never an unbounded loop. The
        // map is keyed by full URL, so match each generated path by suffix.
        expect(callCounts.size).toBe(n);
        for (const path of paths) {
          const entry = [...callCounts.entries()].find(([url]) => url.endsWith(path));
          expect(entry).toBeDefined();
          const hits = entry?.[1];
          expect(hits).toBeLessThanOrEqual(2);
          expect(hits).toBe(2);
        }
      }),
      { numRuns: 100 },
    );
  });
});
