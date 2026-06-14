// Feature: customer-mobile-app, Property 19: Response envelope unwrapping and failure normalization
//
// Validates: Requirements 10.1, 10.2, 10.3
//
// For any success envelope `{ success: true, data, meta }` the client returns
// `{ data, meta }` (R10.1); for any error envelope
// `{ success: false, error: { code, message, details } }` it throws an
// `ApiError` whose `code` equals the envelope code (R10.2); for any non-JSON
// body, well-formed-but-unrecognized shape, or network/timeout rejection it
// throws `ApiError(INTERNAL_ERROR)` and NEVER returns data (R10.3).
//
// The client is exercised through its injectable seams: `createApiClient` is
// given a recording fake `fetch` (driven per-call by the generated scenario)
// and an empty in-memory `TokenStore`, plus an explicit `baseUrl` so importing
// the module never forces env validation. No live backend or device keychain
// is touched. HTTP statuses for the error/failure branches deliberately exclude
// 401 so this property isolates envelope/error normalization from the separate
// single-flight refresh-and-retry behavior (Property 21).
import { ERROR_CODES } from '@queuenow/shared-constants';
import fc from 'fast-check';
import { describe, expect, it, vi } from 'vitest';

// `createApiClient` statically pulls in `@/lib/env` (→ `expo-constants`) and
// `@/lib/auth/secure-store` (→ `expo-secure-store`). Those native packages ship
// Flow-typed source that Vitest's transform cannot parse, and they are never
// exercised by this property (the client gets an injected `baseUrl` + mock
// `TokenStore`). Stub the native boundary so the REAL client logic under test
// loads; nothing about the envelope/error behavior is faked.
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
  jsonResponse,
  nonJsonResponse,
  successResponse,
} from '@/test-support';

const BASE_URL = 'https://api.test.local/api/v1';
const INTERNAL_ERROR = ERROR_CODES.INTERNAL_ERROR;
const ALL_ERROR_CODES = Object.values(ERROR_CODES);

// --- predicates mirroring the client's envelope narrowing (so the
// "unrecognized shape" generator can reliably avoid producing a real envelope).
function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
function looksLikeSuccessEnvelope(value: unknown): boolean {
  return isObject(value) && value.success === true && 'data' in value;
}
function looksLikeErrorEnvelope(value: unknown): boolean {
  if (!isObject(value) || value.success !== false) return false;
  const error = value.error;
  return isObject(error) && typeof (error as Record<string, unknown>).code === 'string';
}

// --- arbitraries -----------------------------------------------------------

/** Arbitrary JSON-serializable domain payload for the success `data`. */
const dataArb: fc.Arbitrary<unknown> = fc.jsonValue();

/** Optional pagination meta — only present keys, all numeric (JSON-safe). */
const metaArb: fc.Arbitrary<{ page?: number; limit?: number; total?: number } | undefined> =
  fc.option(
    fc.record(
      {
        page: fc.nat(),
        limit: fc.nat(),
        total: fc.nat(),
      },
      { requiredKeys: [] },
    ),
    { nil: undefined },
  );

/** Any backend error code (INTERNAL_ERROR included — `.code` still equals it). */
const codeArb: fc.Arbitrary<string> = fc.constantFrom(...ALL_ERROR_CODES);

/** Arbitrary error message + optional details. */
const messageArb: fc.Arbitrary<string> = fc.string();
const detailsArb: fc.Arbitrary<Record<string, unknown> | undefined> = fc.option(
  fc.dictionary(fc.string(), fc.jsonValue()),
  { nil: undefined },
);

/** Non-200 HTTP status that is NOT 401 (401 would trigger the refresh flow). */
const errorStatusArb: fc.Arbitrary<number> = fc
  .integer({ min: 400, max: 599 })
  .filter((status) => status !== 401);

/** Well-formed JSON that is neither a success nor an error envelope. */
const unrecognizedBodyArb: fc.Arbitrary<unknown> = fc
  .jsonValue()
  .filter((value) => !looksLikeSuccessEnvelope(value) && !looksLikeErrorEnvelope(value));

type Scenario =
  | { kind: 'success'; data: unknown; meta?: { page?: number; limit?: number; total?: number } }
  | {
      kind: 'error';
      code: string;
      message: string;
      details?: Record<string, unknown>;
      status: number;
    }
  | { kind: 'failure-nonjson'; status: number }
  | { kind: 'failure-unrecognized'; body: unknown; status: number }
  | { kind: 'failure-network' };

const scenarioArb: fc.Arbitrary<Scenario> = fc.oneof(
  fc
    .record({ data: dataArb, meta: metaArb })
    .map(({ data, meta }): Scenario => ({ kind: 'success', data, meta })),
  fc
    .record({ code: codeArb, message: messageArb, details: detailsArb, status: errorStatusArb })
    .map(
      ({ code, message, details, status }): Scenario => ({
        kind: 'error',
        code,
        message,
        details,
        status,
      }),
    ),
  fc.record({ status: errorStatusArb }).map(
    ({ status }): Scenario => ({
      kind: 'failure-nonjson',
      status,
    }),
  ),
  fc
    .record({ body: unrecognizedBodyArb, status: errorStatusArb })
    .map(({ body, status }): Scenario => ({ kind: 'failure-unrecognized', body, status })),
  fc.constant<Scenario>({ kind: 'failure-network' }),
);

/** JSON round-trip — the exact transform the data undergoes through the Response. */
const roundTrip = (value: unknown): unknown => JSON.parse(JSON.stringify(value));

// --- property --------------------------------------------------------------

describe('Property 19: Response envelope unwrapping and failure normalization', () => {
  it('unwraps success envelopes, throws on error envelopes with the envelope code, and normalizes every malformed/failed response to ApiError(INTERNAL_ERROR) without returning data', async () => {
    await fc.assert(
      fc.asyncProperty(scenarioArb, async (scenario) => {
        // A fresh client per case with an empty token store (no auth header, no
        // fail-closed) and an explicit base URL (no env dependency).
        const fakeFetch = createFakeFetch((): Response => {
          switch (scenario.kind) {
            case 'success':
              return successResponse(scenario.data, scenario.meta);
            case 'error':
              return errorResponse(
                scenario.code,
                scenario.message,
                scenario.details,
                scenario.status,
              );
            case 'failure-nonjson':
              return nonJsonResponse('not json', scenario.status);
            case 'failure-unrecognized':
              return jsonResponse(scenario.body, scenario.status);
            case 'failure-network':
              throw new Error('network down');
          }
        });

        const client = createApiClient({
          fetchFn: fakeFetch.fetch,
          tokenStore: createMockTokenStore(),
          baseUrl: BASE_URL,
        });

        if (scenario.kind === 'success') {
          // R10.1: success envelope → unwrapped { data, meta }.
          const result = await client.get<unknown>('/anything');
          expect(result.data).toEqual(roundTrip(scenario.data));
          expect(result.meta).toEqual(scenario.meta);
          return;
        }

        // Every other branch must throw and must NOT return data.
        let thrown: unknown;
        let returned: unknown;
        try {
          returned = await client.get<unknown>('/anything');
        } catch (error) {
          thrown = error;
        }

        expect(returned).toBeUndefined();
        expect(thrown).toBeInstanceOf(ApiError);
        const apiError = thrown as ApiError;

        if (scenario.kind === 'error') {
          // R10.2: ApiError.code equals the envelope's code, verbatim.
          expect(apiError.code).toBe(scenario.code);
        } else {
          // R10.3: non-JSON, unrecognized shape, and network/timeout rejection
          // all normalize to the synthetic INTERNAL_ERROR.
          expect(apiError.code).toBe(INTERNAL_ERROR);
        }
      }),
      { numRuns: 100 },
    );
  });
});
