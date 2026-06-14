import { MutationCache, QueryCache, QueryClient } from '@tanstack/react-query';

/*
 * Single TanStack Query client for the mobile app (design "TanStack Query usage
 * & query keys", R10.1).
 *
 * Configuration goals (task 2.2):
 * - Retry is disabled for 4xx `ApiError`s: client errors (validation, auth,
 *   not-found) won't succeed on retry, so retrying just delays the error.
 *   Server/network errors (5xx, or synthetic errors with no httpStatus) still
 *   get a bounded retry.
 * - A sensible default `staleTime` avoids refetch storms on remount/refocus
 *   while keeping data reasonably fresh; the socket bridge + manual/connectivity
 *   refresh handle liveness for queue data.
 * - A shared cache error handler (QueryCache + MutationCache `onError`) keyed on
 *   the error `code` field gives a single place to observe failures. It is
 *   intentionally resilient: it works whether or not the thrown value is the
 *   `ApiError` created in task 2.1 (which carries `code`/`httpStatus`).
 * - User-facing copy is NOT hardcoded here. The friendly-copy mapping lives in
 *   `lib/api/error-map.ts` (task 2.3) and feature code remains the authoritative
 *   place for surfacing errors (inline messages / in-app banners).
 */

/**
 * Minimal shape of the `ApiError` thrown by the REST client. The concrete
 * `ApiError` class is implemented in task 2.1 (`@/lib/api/client`); this module
 * only reads `code`/`httpStatus` defensively from an `unknown` thrown value, so
 * it does not take a hard dependency on that module. Once `client.ts` exists the
 * real type can be imported for documentation, but the runtime checks below
 * stay shape-based so synthetic/unknown errors are handled too.
 */
export interface ApiErrorShape {
  code: string;
  details?: Record<string, unknown>;
  httpStatus?: number;
}

/** Number of retries for non-4xx (server/network) failures. */
const SERVER_ERROR_RETRIES = 2;

/** Default staleness window for queries (30 seconds). */
const DEFAULT_STALE_TIME_MS = 30_000;

/**
 * Best-effort extraction of an HTTP status from an unknown thrown value.
 *
 * Kept resilient so it works before `ApiError` exists (task 2.1) and for any
 * error shape that carries a numeric `httpStatus`.
 */
function getHttpStatus(error: unknown): number | undefined {
  if (typeof error === 'object' && error !== null && 'httpStatus' in error) {
    const status = (error as { httpStatus: unknown }).httpStatus;
    if (typeof status === 'number' && Number.isFinite(status)) {
      return status;
    }
  }
  return undefined;
}

/**
 * Best-effort extraction of an application error `code` (e.g. `ApiError.code`
 * mapped from the backend error envelope) from an unknown thrown value.
 */
function getErrorCode(error: unknown): string | undefined {
  if (typeof error === 'object' && error !== null && 'code' in error) {
    const code = (error as { code: unknown }).code;
    if (typeof code === 'string' && code.length > 0) {
      return code;
    }
  }
  return undefined;
}

/** True when the error represents a 4xx client error that won't benefit from a retry. */
function isClientError(error: unknown): boolean {
  const status = getHttpStatus(error);
  return status !== undefined && status >= 400 && status < 500;
}

/**
 * Retry policy: never retry 4xx client errors; otherwise retry up to
 * `SERVER_ERROR_RETRIES` times.
 */
function shouldRetry(failureCount: number, error: unknown): boolean {
  if (isClientError(error)) {
    return false;
  }
  return failureCount < SERVER_ERROR_RETRIES;
}

/**
 * Centralized cache-error observer keyed on the error `code`. Used by both the
 * QueryCache and MutationCache so every failure passes through one place. This
 * handler observes/logs only and does not itself surface UI — feature code owns
 * inline messages and in-app banners, and the `error-map.ts` module (task 2.3)
 * owns the code → friendly-copy mapping.
 */
function handleCacheError(error: unknown): void {
  if (__DEV__) {
    const code = getErrorCode(error);
    // eslint-disable-next-line no-console
    console.error('[query] request failed', { code: code ?? 'UNKNOWN' });
  }
}

export const queryClient = new QueryClient({
  queryCache: new QueryCache({
    onError: handleCacheError,
  }),
  mutationCache: new MutationCache({
    onError: handleCacheError,
  }),
  defaultOptions: {
    queries: {
      retry: shouldRetry,
      staleTime: DEFAULT_STALE_TIME_MS,
    },
    mutations: {
      retry: false,
    },
  },
});
