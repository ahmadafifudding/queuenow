/*
 * Mock API_Client (task 2.4, Requirement 15.1).
 *
 * A boundary double for `lib/api/client.ts`'s `apiClient`. Tests stub responses
 * per HTTP method + path; the mock either resolves with an unwrapped
 * `{ data, meta }` success result OR rejects with a REAL `ApiError` — the same
 * type production code throws — so callers exercise their real error handling
 * (code mapping, field-error mapping) without a backend.
 *
 * It also records every call (method, path, body, options) so tests can assert
 * what the code under test requested.
 *
 * Design notes:
 * - `{method} {path}` is the stub key (exact-match path string).
 * - Per key there is a FIFO queue of one-shot stubs plus an optional sticky
 *   fallback. Resolution shifts the next queued stub if present, otherwise uses
 *   the fallback, otherwise throws a helpful "no stub" error. This supports both
 *   stable queries (sticky `mockSuccess`) and ordered sequences (`queue*`).
 * - The surface (`request/get/post/patch/put/delete`) mirrors the real
 *   `apiClient` so the mock is a drop-in replacement.
 */
import { ApiError, type ApiResult, type Meta, type RequestOptions } from '@/lib/api/client';

/** HTTP verbs the mock understands (matches the real `apiClient` surface). */
export type HttpMethod = 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';

/**
 * The `apiClient`-compatible surface the mock exposes. Mirrors the shape of the
 * real `apiClient` in `lib/api/client.ts` so it can be substituted at the
 * boundary in tests.
 */
export interface ApiClientSurface {
  request<TData>(path: string, options?: RequestOptions): Promise<ApiResult<TData>>;
  get<TData>(path: string, options?: RequestOptions): Promise<ApiResult<TData>>;
  post<TData>(path: string, body?: unknown, options?: RequestOptions): Promise<ApiResult<TData>>;
  patch<TData>(path: string, body?: unknown, options?: RequestOptions): Promise<ApiResult<TData>>;
  put<TData>(path: string, body?: unknown, options?: RequestOptions): Promise<ApiResult<TData>>;
  delete<TData>(path: string, options?: RequestOptions): Promise<ApiResult<TData>>;
}

/** A single recorded request, captured for later assertions. */
export interface RecordedCall {
  /** The resolved HTTP method. */
  method: HttpMethod;
  /** The request path exactly as the caller passed it. */
  path: string;
  /** The structured body argument (for `post`/`patch`/`put`) or the raw `options.body`. */
  body?: unknown;
  /** The full options object the caller supplied, if any. */
  options?: RequestOptions;
}

/** The outcome a stub produces: a success envelope result or a thrown `ApiError`. */
export type StubOutcome<TData> =
  | { kind: 'success'; data: TData; meta?: Meta }
  | { kind: 'error'; error: ApiError };

/** A stub: a fixed outcome or a function computing one from the recorded call. */
export type StubHandler<TData> =
  | StubOutcome<TData>
  | ((call: RecordedCall) => StubOutcome<TData> | Promise<StubOutcome<TData>>);

interface KeyStubs {
  /** One-shot stubs consumed FIFO. */
  queue: StubHandler<unknown>[];
  /** Sticky stub reused once the queue is empty. */
  fallback?: StubHandler<unknown>;
}

/** The public mock surface returned by {@link createMockApiClient}. */
export interface MockApiClient {
  /** The `apiClient`-compatible object to inject into the code under test. */
  readonly client: ApiClientSurface;

  /** Set a sticky success outcome for `method path` (reused across calls). */
  mockSuccess<TData>(method: HttpMethod, path: string, data: TData, meta?: Meta): MockApiClient;
  /** Set a sticky error outcome for `method path` (the mock rejects with this `ApiError`). */
  mockError(method: HttpMethod, path: string, error: ApiError): MockApiClient;
  /** Set a sticky dynamic handler for `method path`. */
  mockResponder<TData>(
    method: HttpMethod,
    path: string,
    handler: StubHandler<TData>,
  ): MockApiClient;

  /** Push a one-shot success outcome (consumed before the fallback, FIFO). */
  queueSuccess<TData>(method: HttpMethod, path: string, data: TData, meta?: Meta): MockApiClient;
  /** Push a one-shot error outcome (consumed before the fallback, FIFO). */
  queueError(method: HttpMethod, path: string, error: ApiError): MockApiClient;
  /** Push a one-shot dynamic handler (consumed before the fallback, FIFO). */
  queueResponder<TData>(
    method: HttpMethod,
    path: string,
    handler: StubHandler<TData>,
  ): MockApiClient;

  /** All recorded calls, in order. */
  getCalls(): readonly RecordedCall[];
  /** Recorded calls filtered to a single `method path`. */
  getCallsFor(method: HttpMethod, path: string): readonly RecordedCall[];
  /** Clear all stubs and recorded calls. */
  reset(): void;
}

/** Build the stub-map key. */
function keyFor(method: HttpMethod, path: string): string {
  return `${method} ${path}`;
}

/** Normalize a `RequestInit['method']` into one of {@link HttpMethod}, defaulting to GET. */
function normalizeMethod(method: string | undefined): HttpMethod {
  const upper = (method ?? 'GET').toUpperCase();
  switch (upper) {
    case 'POST':
    case 'PATCH':
    case 'PUT':
    case 'DELETE':
      return upper;
    default:
      return 'GET';
  }
}

/**
 * Create a mock API_Client.
 *
 * @returns a {@link MockApiClient} whose `client` can be injected wherever the
 * real `apiClient` is used.
 */
export function createMockApiClient(): MockApiClient {
  const stubs = new Map<string, KeyStubs>();
  const calls: RecordedCall[] = [];

  function entryFor(method: HttpMethod, path: string): KeyStubs {
    const key = keyFor(method, path);
    let entry = stubs.get(key);
    if (!entry) {
      entry = { queue: [] };
      stubs.set(key, entry);
    }
    return entry;
  }

  async function resolve<TData>(
    method: HttpMethod,
    path: string,
    body: unknown,
    options: RequestOptions | undefined,
  ): Promise<ApiResult<TData>> {
    const call: RecordedCall = { method, path, body, options };
    calls.push(call);

    const entry = stubs.get(keyFor(method, path));
    const handler = entry?.queue.shift() ?? entry?.fallback;

    if (handler === undefined) {
      throw new ApiError(
        'MOCK_NO_STUB',
        `No mock response registered for ${method} ${path}. ` +
          `Register one with mockSuccess/mockError/queueSuccess/queueError.`,
      );
    }

    const outcome = typeof handler === 'function' ? await handler(call) : handler;

    if (outcome.kind === 'error') {
      throw outcome.error;
    }
    return { data: outcome.data as TData, meta: outcome.meta };
  }

  const client: ApiClientSurface = {
    request: <TData>(path: string, options: RequestOptions = {}): Promise<ApiResult<TData>> =>
      resolve<TData>(normalizeMethod(options.method), path, options.body, options),
    get: <TData>(path: string, options?: RequestOptions): Promise<ApiResult<TData>> =>
      resolve<TData>('GET', path, undefined, options),
    post: <TData>(
      path: string,
      body?: unknown,
      options?: RequestOptions,
    ): Promise<ApiResult<TData>> => resolve<TData>('POST', path, body, options),
    patch: <TData>(
      path: string,
      body?: unknown,
      options?: RequestOptions,
    ): Promise<ApiResult<TData>> => resolve<TData>('PATCH', path, body, options),
    put: <TData>(
      path: string,
      body?: unknown,
      options?: RequestOptions,
    ): Promise<ApiResult<TData>> => resolve<TData>('PUT', path, body, options),
    delete: <TData>(path: string, options?: RequestOptions): Promise<ApiResult<TData>> =>
      resolve<TData>('DELETE', path, undefined, options),
  };

  const mock: MockApiClient = {
    client,

    mockSuccess(method, path, data, meta) {
      entryFor(method, path).fallback = { kind: 'success', data, meta };
      return mock;
    },
    mockError(method, path, error) {
      entryFor(method, path).fallback = { kind: 'error', error };
      return mock;
    },
    mockResponder(method, path, handler) {
      entryFor(method, path).fallback = handler as StubHandler<unknown>;
      return mock;
    },

    queueSuccess(method, path, data, meta) {
      entryFor(method, path).queue.push({ kind: 'success', data, meta });
      return mock;
    },
    queueError(method, path, error) {
      entryFor(method, path).queue.push({ kind: 'error', error });
      return mock;
    },
    queueResponder(method, path, handler) {
      entryFor(method, path).queue.push(handler as StubHandler<unknown>);
      return mock;
    },

    getCalls() {
      return calls;
    },
    getCallsFor(method, path) {
      return calls.filter((call) => call.method === method && call.path === path);
    },
    reset() {
      stubs.clear();
      calls.length = 0;
    },
  };

  return mock;
}
