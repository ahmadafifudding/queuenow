/*
 * API_Client — the single typed REST entry point (steering "API Layer", R2).
 *
 * Responsibilities (Requirements 2.1–2.7, 4.5, 4.6):
 * - Base URL comes from the validated `env.VITE_API_URL` — no hardcoded URLs.
 * - Every request is sent with `credentials: 'include'` so the httpOnly refresh
 *   cookie is transmitted (R2.2).
 * - When a token is present in the Auth_Store, an `Authorization: Bearer <token>`
 *   header is attached; when it is null, no such header is sent (R2.3).
 * - Success envelopes `{ success: true, data, meta }` are unwrapped to
 *   `{ data, meta }` (R2.4, R2.5).
 * - Error envelopes `{ success: false, error: { code, message, details } }` throw
 *   a typed `ApiError` carrying the code/details so callers can map them to copy
 *   and field errors (R2.6, R4.10).
 * - A network failure (fetch rejects) becomes a synthetic `ApiError` with code
 *   `INTERNAL_ERROR`.
 * - On a `401`, a SINGLE silent `POST /auth/refresh` runs, the in-memory token is
 *   updated, and the original request is retried exactly once. Concurrent 401s
 *   share ONE in-flight refresh promise (single-flight), so only one refresh ever
 *   happens per cycle and the flow never loops unbounded (R4.6). On refresh
 *   failure the Auth_Store is cleared and a redirect-to-login is signaled (R4.7).
 *
 * Feature code never calls `fetch` directly — it uses TanStack Query hooks in
 * each feature's `api/` folder that call `apiClient` (R2.1). Concrete
 * request/response types are supplied by those hooks (derived from the generated
 * `schema.d.ts` and `@queuenow/shared-types`); this client stays generic over the
 * response `data` type so its correctness is independent of the generated schema.
 */
import type { ILoginResponse } from '@queuenow/shared-types';

import { useAuthStore } from '@/features/auth/stores/auth-store';
import { env } from '@/lib/env';

/** Pagination metadata exposed from a (paginated) success envelope (R2.5). */
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
 * envelope is available (network failure, non-JSON body, unexpected shape).
 * It resolves to the generic fallback copy via `lib/api/error-map.ts`.
 */
export const INTERNAL_ERROR_CODE = 'INTERNAL_ERROR';

/**
 * Typed error thrown for any non-successful API outcome. Carries the backend
 * `error.code` (mapped to friendly copy by `lib/api/error-map.ts`), the raw
 * `details` (used for field-error mapping, R4.10), and the HTTP status.
 */
export class ApiError extends Error {
  /** The backend error code (e.g. `AUTH_INVALID_CREDENTIALS`) or `INTERNAL_ERROR`. */
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

/** Options accepted by {@link request}; mirrors `RequestInit` minus `credentials`. */
export type RequestOptions = Omit<RequestInit, 'credentials'>;

// ---------------------------------------------------------------------------
// Refresh-failure signal (wired by the boot lifecycle, task 6.2)
// ---------------------------------------------------------------------------

/** Callback invoked after a failed refresh clears the Auth_Store (e.g. redirect to /login). */
type UnauthorizedHandler = () => void;

let onUnauthorized: UnauthorizedHandler | null = null;

/**
 * Register the handler invoked when a silent refresh fails (after the
 * Auth_Store has been cleared). Task 6.2 connects this to router navigation so
 * the user is redirected to `/login`. Passing `null` removes the handler.
 *
 * @param handler Redirect/cleanup callback, or `null` to clear it.
 */
export function setUnauthorizedHandler(handler: UnauthorizedHandler | null): void {
  onUnauthorized = handler;
}

// ---------------------------------------------------------------------------
// URL + request construction
// ---------------------------------------------------------------------------

/** Join the configured base URL with a request path, tolerating slashes on either side. */
function buildUrl(path: string): string {
  const base = env.VITE_API_URL.replace(/\/+$/, '');
  const suffix = path.replace(/^\/+/, '');
  return `${base}/${suffix}`;
}

/**
 * Build the final `RequestInit`: forces `credentials: 'include'`, attaches the
 * Bearer header when a token is present (read freshly from the Auth_Store so a
 * refreshed token is used on retry), and defaults JSON `Content-Type` when a
 * body is present and no explicit type was set.
 */
function buildInit(options: RequestOptions): RequestInit {
  const headers = new Headers(options.headers);

  const token = useAuthStore.getState().accessToken;
  if (token) {
    headers.set('Authorization', `Bearer ${token}`);
  }

  if (options.body !== undefined && options.body !== null && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  return { ...options, headers, credentials: 'include' };
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

  // Well-formed JSON but not a recognized envelope → treat as an internal error
  // rather than leaking an unknown shape to callers.
  throw new ApiError(
    INTERNAL_ERROR_CODE,
    'The server returned an unexpected response shape.',
    undefined,
    httpStatus,
  );
}

// ---------------------------------------------------------------------------
// Single-flight 401 refresh-and-retry (R4.6, R4.7)
// ---------------------------------------------------------------------------

/** The in-flight refresh promise shared by all concurrent 401s, or `null` when idle. */
let refreshPromise: Promise<void> | null = null;

function isLoginResponse(value: unknown): value is ILoginResponse {
  if (!isObject(value)) {
    return false;
  }
  const tokens = value.tokens;
  return isObject(tokens) && typeof tokens.accessToken === 'string';
}

/** Clear the session and signal a redirect to login (R4.7). */
function handleRefreshFailure(): void {
  useAuthStore.getState().clear();
  onUnauthorized?.();
}

/**
 * Perform exactly one `POST /auth/refresh`. On success, update the Auth_Store
 * with the new session; on any failure, clear the store, signal redirect, and
 * throw an `ApiError`. This call deliberately does NOT go through {@link request}
 * (no recursive 401 handling) so refresh can never loop.
 */
async function performRefresh(): Promise<void> {
  let response: Response;
  try {
    response = await fetch(buildUrl('/auth/refresh'), {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
    });
  } catch {
    handleRefreshFailure();
    throw new ApiError(INTERNAL_ERROR_CODE, 'Unable to reach the server to refresh the session.');
  }

  if (!response.ok) {
    handleRefreshFailure();
    throw new ApiError(
      'AUTH_REFRESH_FAILED',
      'Your session could not be refreshed.',
      undefined,
      response.status,
    );
  }

  const body = await parseJson(response).catch((error: unknown) => {
    handleRefreshFailure();
    throw error;
  });

  if (isSuccessEnvelope<unknown>(body) && isLoginResponse(body.data)) {
    useAuthStore.getState().setSession(body.data);
    return;
  }

  handleRefreshFailure();
  throw new ApiError(
    'AUTH_REFRESH_FAILED',
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
 *
 * Exported so the boot lifecycle (task 6.2) can reuse it for the initial silent
 * session restore (R4.5).
 */
export function refreshAccessToken(): Promise<void> {
  if (refreshPromise === null) {
    refreshPromise = performRefresh().finally(() => {
      refreshPromise = null;
    });
  }
  return refreshPromise;
}

// ---------------------------------------------------------------------------
// Core request
// ---------------------------------------------------------------------------

async function executeRequest<TData>(
  path: string,
  options: RequestOptions,
  isRetry: boolean,
): Promise<ApiResult<TData>> {
  let response: Response;
  try {
    response = await fetch(buildUrl(path), buildInit(options));
  } catch {
    // Network failure (DNS, offline, CORS, aborted connection) → synthetic error.
    throw new ApiError(INTERNAL_ERROR_CODE, 'Unable to reach the server. Check your connection.');
  }

  // On the first 401, refresh once (single-flight) then retry the request once.
  // If refresh fails it throws here and we never retry — so the flow is bounded.
  if (response.status === 401 && !isRetry) {
    await refreshAccessToken();
    return executeRequest<TData>(path, options, true);
  }

  const body = await parseJson(response);
  return unwrapEnvelope<TData>(body, response.status);
}

/**
 * Make a typed REST request through the single API_Client.
 *
 * @typeParam TData The expected shape of the unwrapped `data` field.
 * @param path Request path relative to `env.VITE_API_URL` (e.g. `/queue/status`).
 * @param options Standard fetch options (method, body, headers, signal, …).
 * @returns The unwrapped `{ data, meta }` from the success envelope.
 * @throws {ApiError} On an error envelope, a network failure, or an unexpected
 * response. After an unrecoverable `401` (failed refresh) the session is cleared.
 */
export function request<TData>(
  path: string,
  options: RequestOptions = {},
): Promise<ApiResult<TData>> {
  return executeRequest<TData>(path, options, false);
}

/**
 * Convenience verb helpers over {@link request}. Bodies are JSON-serialized and
 * the JSON `Content-Type` is applied automatically by {@link buildInit}.
 */
export const apiClient = {
  request,
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
  patch<TData>(path: string, body?: unknown, options?: RequestOptions): Promise<ApiResult<TData>> {
    return request<TData>(path, {
      ...options,
      method: 'PATCH',
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  },
  put<TData>(path: string, body?: unknown, options?: RequestOptions): Promise<ApiResult<TData>> {
    return request<TData>(path, {
      ...options,
      method: 'PUT',
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  },
  delete<TData>(path: string, options?: RequestOptions): Promise<ApiResult<TData>> {
    return request<TData>(path, { ...options, method: 'DELETE' });
  },
} as const;
