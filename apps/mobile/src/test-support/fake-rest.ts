/**
 * REST boundary fakes (boundary harness — task 2.4).
 *
 * Provides the seams `createApiClient` (`src/lib/api/client.ts`) depends on so
 * the envelope/error, auth-header, and single-flight 401 refresh logic
 * (Properties 19/15/21) can be exercised without a live backend:
 *
 *  - Envelope builders ({@link successEnvelope}/{@link errorEnvelope}) and
 *    `Response` builders ({@link jsonResponse}/{@link successResponse}/
 *    {@link errorResponse}/{@link nonJsonResponse}) that mirror the backend's
 *    `{ success, data, meta }` / `{ success, error }` contract.
 *  - {@link createFakeFetch} — a recording `fetch` implementation driven by a
 *    per-call responder, plus {@link createSequencedFetch} for a fixed script of
 *    responses (handy for the refresh-then-retry flow).
 *  - {@link createMockTokenStore} — an in-memory `TokenStore` with injectable
 *    read failures, matching the `createApiClient` `tokenStore` seam.
 *
 * Real `Response`/`Headers` globals (Node 18+/undici, present under Vitest) back
 * the builders, so the client's `response.json()` / `response.ok` / `.status`
 * paths are exercised exactly as in production.
 */
import type { TokenStore } from '@/lib/api/client';

/** A success envelope as emitted by the backend interceptor (R10.1). */
export interface SuccessEnvelope<TData> {
  success: true;
  data: TData;
  meta?: { page?: number; limit?: number; total?: number };
}

/** An error envelope as emitted by the backend exception filter (R10.2). */
export interface ErrorEnvelope {
  success: false;
  error: { code: string; message: string; details?: Record<string, unknown> };
}

/** Build a success envelope `{ success: true, data, meta? }`. */
export function successEnvelope<TData>(
  data: TData,
  meta?: SuccessEnvelope<TData>['meta'],
): SuccessEnvelope<TData> {
  return meta === undefined ? { success: true, data } : { success: true, data, meta };
}

/** Build an error envelope `{ success: false, error: { code, message, details? } }`. */
export function errorEnvelope(
  code: string,
  message = 'Error',
  details?: Record<string, unknown>,
): ErrorEnvelope {
  return { success: false, error: { code, message, details } };
}

/** Build a JSON `Response` with the given body and status (default 200). */
export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

/** Build a 200 (or given status) JSON success-envelope `Response`. */
export function successResponse<TData>(
  data: TData,
  meta?: SuccessEnvelope<TData>['meta'],
  status = 200,
): Response {
  return jsonResponse(successEnvelope(data, meta), status);
}

/** Build an error-envelope `Response` (default HTTP 400). */
export function errorResponse(
  code: string,
  message = 'Error',
  details?: Record<string, unknown>,
  status = 400,
): Response {
  return jsonResponse(errorEnvelope(code, message, details), status);
}

/** Build a non-JSON `Response` (drives the R10.3 INTERNAL_ERROR path). */
export function nonJsonResponse(text = 'not json', status = 200): Response {
  return new Response(text, { status, headers: { 'Content-Type': 'text/plain' } });
}

/** A recorded fetch invocation (normalized for easy assertions). */
export interface FetchCall {
  /** The URL fetched. */
  url: string;
  /** Uppercased HTTP method (defaults to `GET`). */
  method: string;
  /** Request headers as a real `Headers` instance. */
  headers: Headers;
  /** The request body, when a string body was provided. */
  body?: string;
  /** The raw init passed to `fetch`. */
  init?: RequestInit;
}

/** A fake `fetch` plus the log of calls it received. */
export interface FakeFetch {
  /** The `fetch`-compatible function to inject as `fetchFn`. */
  fetch: typeof fetch;
  /** Every call received, in order. */
  readonly calls: FetchCall[];
}

function toFetchCall(input: RequestInfo | URL, init?: RequestInit): FetchCall {
  const url = typeof input === 'string' ? input : input.toString();
  const method = (init?.method ?? 'GET').toUpperCase();
  const headers = new Headers(init?.headers);
  const body = typeof init?.body === 'string' ? init.body : undefined;
  return init === undefined ? { url, method, headers, body } : { url, method, headers, body, init };
}

/**
 * Build a recording fake `fetch` whose response is computed per call by the
 * given responder. Throw inside the responder to simulate a network/timeout
 * rejection (the client maps it to a synthetic `INTERNAL_ERROR`, R10.3).
 */
export function createFakeFetch(
  responder: (call: FetchCall) => Response | Promise<Response>,
): FakeFetch {
  const calls: FetchCall[] = [];
  const fetchFn = (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const call = toFetchCall(input, init);
    calls.push(call);
    return responder(call);
  }) as typeof fetch;
  return { fetch: fetchFn, calls };
}

/**
 * Build a recording fake `fetch` that returns a fixed script of responses in
 * order (each entry may be a `Response` or a thunk producing one — use a thunk
 * to throw and simulate a network failure). After the script is exhausted the
 * last entry is reused, so a steady-state response can be expressed by a single
 * trailing element.
 */
export function createSequencedFetch(
  script: ReadonlyArray<Response | (() => Response)>,
): FakeFetch {
  if (script.length === 0) {
    throw new Error('createSequencedFetch requires at least one response');
  }
  let index = 0;
  return createFakeFetch(() => {
    const entry = script[Math.min(index, script.length - 1)];
    index += 1;
    // `entry` is defined: index is clamped within bounds and the array is non-empty.
    return typeof entry === 'function' ? entry() : (entry as Response);
  });
}

/** Knobs for {@link createMockTokenStore}. */
export interface MockTokenStoreOptions {
  /** Initial access token (default `null`). */
  accessToken?: string | null;
  /** Initial refresh token (default `null`). */
  refreshToken?: string | null;
  /** When `true`, `getAccessToken` rejects (store read failure → fail-closed). */
  failGetAccessToken?: boolean;
  /** When `true`, `getRefreshToken` rejects. */
  failGetRefreshToken?: boolean;
}

/** A {@link TokenStore} fake plus introspection of the current values. */
export interface MockTokenStore extends TokenStore {
  /** Current in-memory access token. */
  readonly current: { accessToken: string | null; refreshToken: string | null };
  /** Call counts for each operation. */
  readonly calls: { getAccess: number; getRefresh: number; set: number; clear: number };
  /** Toggle access-token read failure at runtime. */
  setFailGetAccessToken(fail: boolean): void;
}

/**
 * Build an in-memory {@link TokenStore} for injecting into `createApiClient`.
 * Mirrors the production secure-store-backed store's contract: `getAccessToken`
 * /`getRefreshToken` resolve the current value (or reject when failure is
 * simulated), `setTokens` replaces both, `clearTokens` removes both.
 */
export function createMockTokenStore(options: MockTokenStoreOptions = {}): MockTokenStore {
  let accessToken: string | null = options.accessToken ?? null;
  let refreshToken: string | null = options.refreshToken ?? null;
  let failGetAccess = options.failGetAccessToken ?? false;
  const failGetRefresh = options.failGetRefreshToken ?? false;
  const calls = { getAccess: 0, getRefresh: 0, set: 0, clear: 0 };

  return {
    calls,
    get current() {
      return { accessToken, refreshToken };
    },
    async getAccessToken() {
      calls.getAccess += 1;
      if (failGetAccess) {
        throw new Error('token-store: read failed');
      }
      return accessToken;
    },
    async getRefreshToken() {
      calls.getRefresh += 1;
      if (failGetRefresh) {
        throw new Error('token-store: read failed');
      }
      return refreshToken;
    },
    async setTokens(tokens) {
      calls.set += 1;
      accessToken = tokens.accessToken;
      refreshToken = tokens.refreshToken;
    },
    async clearTokens() {
      calls.clear += 1;
      accessToken = null;
      refreshToken = null;
    },
    setFailGetAccessToken(fail) {
      failGetAccess = fail;
    },
  };
}
