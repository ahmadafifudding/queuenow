/*
 * REST Client (Queue_Client transport) — the single typed REST entry point for
 * the mobile app. Mirrors `apps/web`'s `lib/api/client.ts` envelope/error
 * semantics, adapted for React Native / device token handling.
 *
 * Responsibilities (Requirements 10.1–10.3, 6.4, 6.5, 12.1, 12.3, 12.4):
 * - Base URL comes from the validated `env.EXPO_PUBLIC_API_URL` — no hardcoded
 *   URLs (the base is resolved lazily so importing this module never forces env
 *   validation before the app boot gate has a chance to run).
 * - Success envelopes `{ success: true, data, meta }` are unwrapped to
 *   `{ data, meta }` (R10.1).
 * - Error envelopes `{ success: false, error: { code, message, details } }` throw
 *   a typed `ApiError(code, message, details, httpStatus)` (R10.2).
 * - A non-JSON body, a well-formed-but-unrecognized body, or a network/timeout
 *   rejection becomes a synthetic `ApiError(INTERNAL_ERROR)` so the UI can offer
 *   a retry (R10.3).
 * - Auth header (R6.4/R6.5): before each request the access token is read from
 *   the token store (backed by `expo-secure-store`). When present it is attached
 *   as `Authorization: Bearer <token>`. For a request marked `authenticated`, the
 *   client FAILS CLOSED — if a token cannot be obtained (store read fails or
 *   returns null) it throws an `ApiError` and never sends the request without the
 *   header (R6.5).
 * - 401 refresh-and-retry (R12.1/R12.3/R12.4): a SINGLE in-flight refresh is
 *   shared across concurrent 401s (single-flight). On success the stored tokens
 *   are replaced and the original request is retried exactly once. On failure the
 *   tokens are cleared and a return-to-sign-in signal fires. Refresh calls
 *   `POST /customers/refresh` (configurable) with the refresh token in the BODY
 *   (the device has no httpOnly cookie). The endpoint is not yet guaranteed to
 *   exist, so a `404`/`501` (or any non-OK) is treated as a refresh FAILURE
 *   (clear tokens, route to sign-in) rather than looping — graceful degradation.
 *
 * Testability: all I/O is injected. `createApiClient(deps)` accepts a `fetch`
 * implementation, a `TokenStore`, a session-invalid signal, the refresh path,
 * and the base URL, so the 2.x property tests can mock `fetch` + the token
 * source without a device keychain or live backend. The default `apiClient`
 * binds the real `expo-secure-store`-backed token store and global `fetch`.
 */
import { ERROR_CODES } from '@queuenow/shared-constants';
import type { ICustomerLoginResponse } from '@queuenow/shared-types';

import { authStore } from '@/lib/auth/auth-store';
import { SECURE_STORE_KEYS, secureStore, type SecureStoreApi } from '@/lib/auth/secure-store';
import { env } from '@/lib/env';

/** Pagination metadata exposed from a (paginated) success envelope. */
export interface Meta {
  page?: number;
  limit?: number;
  total?: number;
}

/** The unwrapped result returned to callers: domain `data` plus optional `meta`. */
export interface ApiResult<TData> {
  data: TData;
  meta?: Meta;
}

/**
 * Synthetic error code used when a request fails before a structured error
 * envelope is available (network/timeout failure, non-JSON body, unexpected
 * shape). Resolves to the generic fallback copy via `lib/api/error-map.ts`.
 */
export const INTERNAL_ERROR_CODE: string = ERROR_CODES.INTERNAL_ERROR;

/**
 * Typed error thrown for any non-successful API outcome. Carries the backend
 * `error.code` (mapped to friendly copy by `lib/api/error-map.ts`, never keyed on
 * message text), the raw `details` (for field-error mapping), and the HTTP
 * status. The shape matches what `query-client`/`invalidation`/`error-map`
 * expect (a structural `{ code }` carrier).
 */
export class ApiError extends Error {
  /** The backend error code (an `ERROR_CODES` value) or `INTERNAL_ERROR`. */
  public readonly code: string;
  /** Optional structured details, e.g. `{ email: 'already taken' }` for forms. */
  public readonly details?: Record<string, unknown>;
  /** The HTTP status of the response, when one was received. */
  public readonly httpStatus?: number;

  constructor(
    code: string,
    message: string,
    details?: Record<string, unknown>,
    httpStatus?: number,
  ) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.details = details;
    this.httpStatus = httpStatus;
    // Restore the prototype chain for `instanceof` when targeting ES5/ES6.
    Object.setPrototypeOf(this, ApiError.prototype);
  }
}

/**
 * Options accepted by {@link request}; mirrors `RequestInit` minus `credentials`
 * (the device has no cookie jar), plus the `authenticated` flag.
 */
export interface RequestOptions extends Omit<RequestInit, 'credentials'> {
  /**
   * When `true`, the request MUST carry a Bearer token. If the token cannot be
   * obtained the client fails closed: it throws an `ApiError` and does NOT send
   * the request unauthenticated (R6.5).
   */
  authenticated?: boolean;
}

// ---------------------------------------------------------------------------
// Token store abstraction (the seam tests swap out)
// ---------------------------------------------------------------------------

/**
 * The token source the client depends on. The default implementation is backed
 * by `expo-secure-store`, but tests inject a fake so the auth-header and
 * refresh logic are verified without a device keychain.
 */
export interface TokenStore {
  /** The current access token, or `null` when none is stored. May reject. */
  getAccessToken(): Promise<string | null>;
  /** The current refresh token, or `null` when none is stored. May reject. */
  getRefreshToken(): Promise<string | null>;
  /** Replace both stored tokens (used after a successful refresh). */
  setTokens(tokens: { accessToken: string; refreshToken: string }): Promise<void>;
  /** Remove both stored tokens (used on sign-out / failed refresh). */
  clearTokens(): Promise<void>;
}

/** Build the default `expo-secure-store`-backed token store (R6.7). */
export function createSecureTokenStore(store: SecureStoreApi = secureStore): TokenStore {
  return {
    getAccessToken: () => store.read(SECURE_STORE_KEYS.accessToken),
    getRefreshToken: () => store.read(SECURE_STORE_KEYS.refreshToken),
    async setTokens({ accessToken, refreshToken }) {
      await store.write(SECURE_STORE_KEYS.accessToken, accessToken);
      await store.write(SECURE_STORE_KEYS.refreshToken, refreshToken);
    },
    async clearTokens() {
      await store.remove(SECURE_STORE_KEYS.accessToken);
      await store.remove(SECURE_STORE_KEYS.refreshToken);
    },
  };
}

// ---------------------------------------------------------------------------
// Return-to-sign-in signal (wired by the boot lifecycle / auth manager)
// ---------------------------------------------------------------------------

/** Callback invoked after a failed refresh clears the session (e.g. route to sign-in). */
type UnauthorizedHandler = () => void;

let onUnauthorized: UnauthorizedHandler | null = null;

/**
 * Register the handler invoked when a refresh fails (after tokens are cleared).
 * The boot lifecycle connects this to navigation so the user is routed back to
 * sign-in and account-scoped query data is dropped. Passing `null` clears it.
 */
export function setUnauthorizedHandler(handler: UnauthorizedHandler | null): void {
  onUnauthorized = handler;
}

// ---------------------------------------------------------------------------
// Envelope narrowing
// ---------------------------------------------------------------------------

interface SuccessEnvelope<TData> {
  success: true;
  data: TData;
  meta?: Meta;
}

interface ErrorEnvelope {
  success: false;
  error: { code: string; message: string; details?: Record<string, unknown> };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isSuccessEnvelope<TData>(value: unknown): value is SuccessEnvelope<TData> {
  return isObject(value) && value.success === true && 'data' in value;
}

function isErrorEnvelope(value: unknown): value is ErrorEnvelope {
  if (!isObject(value) || value.success !== false) {
    return false;
  }
  const error = value.error;
  return isObject(error) && typeof error.code === 'string';
}

/** Narrow a refresh response body's `data` to the customer token-pair shape. */
function hasTokenPair(value: unknown): value is ICustomerLoginResponse {
  if (!isObject(value)) {
    return false;
  }
  const tokens = value.tokens;
  return (
    isObject(tokens) &&
    typeof tokens.accessToken === 'string' &&
    typeof tokens.refreshToken === 'string'
  );
}

// ---------------------------------------------------------------------------
// Client factory
// ---------------------------------------------------------------------------

/** Default refresh path (R12; the endpoint added by task 17.1). */
const DEFAULT_REFRESH_PATH = '/customers/refresh';

/** Dependencies injected into {@link createApiClient}; all optional with real defaults. */
export interface ApiClientDeps {
  /** `fetch` implementation. Defaults to the global `fetch`. */
  fetchFn?: typeof fetch;
  /** Token source. Defaults to the `expo-secure-store`-backed store. */
  tokenStore?: TokenStore;
  /**
   * Signal fired after a refresh fails and tokens are cleared (return-to-sign-in).
   * Defaults to clearing the in-memory auth mirror and invoking the registered
   * {@link setUnauthorizedHandler}.
   */
  onSessionInvalid?: () => void;
  /** Refresh endpoint path. Defaults to {@link DEFAULT_REFRESH_PATH}. */
  refreshPath?: string;
  /** Base URL. Defaults to the lazily-resolved `env.EXPO_PUBLIC_API_URL`. */
  baseUrl?: string;
}

/** The verb-helper surface returned by {@link createApiClient}. */
export interface ApiClient {
  request<TData>(path: string, options?: RequestOptions): Promise<ApiResult<TData>>;
  get<TData>(path: string, options?: RequestOptions): Promise<ApiResult<TData>>;
  post<TData>(path: string, body?: unknown, options?: RequestOptions): Promise<ApiResult<TData>>;
  patch<TData>(path: string, body?: unknown, options?: RequestOptions): Promise<ApiResult<TData>>;
  delete<TData>(path: string, options?: RequestOptions): Promise<ApiResult<TData>>;
  /** Force a single-flight refresh (shared with the 401 flow). Mainly for boot/restore. */
  refreshAccessToken(): Promise<void>;
}

/**
 * Construct an API client over the given dependencies. Each client owns its own
 * single-flight refresh slot, so tests are fully isolated. The default
 * {@link apiClient} is one such instance bound to the real dependencies.
 */
export function createApiClient(deps: ApiClientDeps = {}): ApiClient {
  const fetchFn = deps.fetchFn ?? globalThis.fetch;
  const tokenStore = deps.tokenStore ?? createSecureTokenStore();
  const refreshPath = deps.refreshPath ?? DEFAULT_REFRESH_PATH;
  const onSessionInvalid =
    deps.onSessionInvalid ??
    (() => {
      authStore.getState().clear();
      onUnauthorized?.();
    });

  /** Resolve the base URL lazily so importing the module never forces env validation. */
  const getBaseUrl = (): string => deps.baseUrl ?? env.EXPO_PUBLIC_API_URL;

  /** Join the base URL with a request path, tolerating slashes on either side. */
  function buildUrl(path: string): string {
    const base = getBaseUrl().replace(/\/+$/, '');
    const suffix = path.replace(/^\/+/, '');
    return `${base}/${suffix}`;
  }

  /** Parse a response body as JSON, or throw a synthetic `INTERNAL_ERROR` on non-JSON. */
  async function parseJson(response: Response): Promise<unknown> {
    try {
      return (await response.json()) as unknown;
    } catch {
      throw new ApiError(
        INTERNAL_ERROR_CODE,
        'The server returned an unreadable response.',
        undefined,
        response.status,
      );
    }
  }

  /** Turn a parsed body into either the unwrapped result or a thrown `ApiError`. */
  function unwrapEnvelope<TData>(body: unknown, httpStatus: number): ApiResult<TData> {
    if (isSuccessEnvelope<TData>(body)) {
      return { data: body.data, meta: body.meta };
    }
    if (isErrorEnvelope(body)) {
      throw new ApiError(body.error.code, body.error.message, body.error.details, httpStatus);
    }
    // Well-formed JSON but not a recognized envelope → internal error rather than
    // leaking an unknown shape to callers (R10.3).
    throw new ApiError(
      INTERNAL_ERROR_CODE,
      'The server returned an unexpected response.',
      undefined,
      httpStatus,
    );
  }

  /**
   * Build the final `RequestInit`. Reads the access token from the token store
   * and attaches `Authorization: Bearer <token>` when present. For an
   * `authenticated` request, fails closed by throwing an `ApiError` when the
   * token cannot be obtained — the caller never reaches `fetch` (R6.5).
   */
  async function buildInit(options: RequestOptions): Promise<RequestInit> {
    const { authenticated, headers: optionHeaders, ...rest } = options;
    const headers = new Headers(optionHeaders);

    let token: string | null = null;
    try {
      token = await tokenStore.getAccessToken();
    } catch {
      // Store read failed. For an authenticated request this is fatal (fail
      // closed); otherwise proceed token-less.
      if (authenticated) {
        throw new ApiError(
          ERROR_CODES.AUTH_UNAUTHORIZED,
          'You must be signed in to perform this action.',
        );
      }
      token = null;
    }

    if (authenticated && !token) {
      // Fail closed: never send an authenticated request without the header.
      throw new ApiError(
        ERROR_CODES.AUTH_UNAUTHORIZED,
        'You must be signed in to perform this action.',
      );
    }

    if (token) {
      headers.set('Authorization', `Bearer ${token}`);
    }

    if (rest.body !== undefined && rest.body !== null && !headers.has('Content-Type')) {
      headers.set('Content-Type', 'application/json');
    }

    return { ...rest, headers };
  }

  // -------------------------------------------------------------------------
  // Single-flight 401 refresh-and-retry (R12.1, R12.3, R12.4)
  // -------------------------------------------------------------------------

  /** The in-flight refresh promise shared by all concurrent 401s, or `null` when idle. */
  let refreshPromise: Promise<void> | null = null;

  /** Clear tokens and signal a return to sign-in (R12.4). */
  async function handleRefreshFailure(): Promise<void> {
    try {
      await tokenStore.clearTokens();
    } catch {
      // Best-effort clear; still signal sign-out below.
    }
    onSessionInvalid();
  }

  /**
   * Perform exactly one `POST {refreshPath}` with the refresh token in the body.
   * On success, replace the stored tokens; on any failure (network, non-OK
   * including 404/501, non-JSON, or an unexpected body) clear tokens, signal
   * return-to-sign-in, and throw. This call deliberately does NOT go through
   * {@link executeRequest} (no recursive 401 handling) so refresh can never loop.
   */
  async function performRefresh(): Promise<void> {
    let refreshToken: string | null;
    try {
      refreshToken = await tokenStore.getRefreshToken();
    } catch {
      await handleRefreshFailure();
      throw new ApiError(INTERNAL_ERROR_CODE, 'Unable to read the stored session.');
    }

    if (!refreshToken) {
      await handleRefreshFailure();
      throw new ApiError(ERROR_CODES.AUTH_UNAUTHORIZED, 'Your session has expired.');
    }

    let response: Response;
    try {
      response = await fetchFn(buildUrl(refreshPath), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken }),
      });
    } catch {
      await handleRefreshFailure();
      throw new ApiError(INTERNAL_ERROR_CODE, 'Unable to reach the server to refresh the session.');
    }

    if (!response.ok) {
      // Any non-OK — including 404/501 while the endpoint is not yet deployed —
      // is a refresh failure: clear tokens and route to sign-in, never loop.
      await handleRefreshFailure();
      throw new ApiError(
        ERROR_CODES.AUTH_TOKEN_EXPIRED,
        'Your session could not be refreshed.',
        undefined,
        response.status,
      );
    }

    let body: unknown;
    try {
      body = await parseJson(response);
    } catch (error) {
      await handleRefreshFailure();
      throw error;
    }

    if (isSuccessEnvelope<unknown>(body) && hasTokenPair(body.data)) {
      await tokenStore.setTokens(body.data.tokens);
      return;
    }

    await handleRefreshFailure();
    throw new ApiError(
      ERROR_CODES.AUTH_TOKEN_EXPIRED,
      'Your session could not be refreshed.',
      undefined,
      response.status,
    );
  }

  /**
   * Refresh the access token, sharing a single in-flight refresh across all
   * concurrent callers (single-flight). The first caller starts the refresh;
   * everyone else awaits the same promise. The slot is released once it settles,
   * so a later 401 can start a fresh cycle.
   */
  function refreshAccessToken(): Promise<void> {
    if (refreshPromise === null) {
      refreshPromise = performRefresh().finally(() => {
        refreshPromise = null;
      });
    }
    return refreshPromise;
  }

  // -------------------------------------------------------------------------
  // Core request
  // -------------------------------------------------------------------------

  async function executeRequest<TData>(
    path: string,
    options: RequestOptions,
    isRetry: boolean,
  ): Promise<ApiResult<TData>> {
    // buildInit may throw an ApiError (fail-closed) BEFORE any network call —
    // that propagates directly and the request is never sent (R6.5).
    const init = await buildInit(options);

    let response: Response;
    try {
      response = await fetchFn(buildUrl(path), init);
    } catch {
      // Network failure / timeout / aborted connection → synthetic error (R10.3).
      throw new ApiError(INTERNAL_ERROR_CODE, 'Unable to reach the server. Check your connection.');
    }

    // On the first 401, refresh once (single-flight) then retry exactly once.
    // If refresh fails it throws here and we never retry — so the flow is bounded.
    if (response.status === 401 && !isRetry) {
      await refreshAccessToken();
      return executeRequest<TData>(path, options, true);
    }

    const body = await parseJson(response);
    return unwrapEnvelope<TData>(body, response.status);
  }

  function request<TData>(path: string, options: RequestOptions = {}): Promise<ApiResult<TData>> {
    return executeRequest<TData>(path, options, false);
  }

  return {
    request,
    refreshAccessToken,
    get<TData>(path: string, options?: RequestOptions): Promise<ApiResult<TData>> {
      return request<TData>(path, { ...options, method: 'GET' });
    },
    post<TData>(path: string, body?: unknown, options?: RequestOptions): Promise<ApiResult<TData>> {
      return request<TData>(path, {
        ...options,
        method: 'POST',
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    },
    patch<TData>(
      path: string,
      body?: unknown,
      options?: RequestOptions,
    ): Promise<ApiResult<TData>> {
      return request<TData>(path, {
        ...options,
        method: 'PATCH',
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    },
    delete<TData>(path: string, options?: RequestOptions): Promise<ApiResult<TData>> {
      return request<TData>(path, { ...options, method: 'DELETE' });
    },
  };
}

/**
 * The default REST client, bound to the global `fetch` and the real
 * `expo-secure-store`-backed token store. Feature code uses this through
 * TanStack Query hooks; tests construct isolated instances via
 * {@link createApiClient}.
 */
export const apiClient: ApiClient = createApiClient();
