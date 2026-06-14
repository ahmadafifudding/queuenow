// Feature: customer-mobile-app, Task 11.2 example tests
//
// Validates: Requirements 6.1, 6.2, 6.3, 6.6
//
// Concrete example cases for the auth flow that backs the sign-in / register /
// sign-out screens. The suite runs in a node environment with no React renderer,
// so it exercises the Auth_Manager directly — the `useLogin`/`useRegister`/
// `useSignOut` hooks are thin TanStack Query wrappers whose `mutationFn` is
// exactly `authManager.{login,register,signOut}`, so the manager IS the contract
// the screens depend on (e.g. the "submit disabled while pending" UI state is
// driven by the mutation's pending state, which resolves/rejects per the manager
// outcomes asserted here; the screen rendering itself is covered separately).
//
// The Auth_Manager is built through its injectable seams (`createAuthManager`):
//   - a fake `apiClient` whose `post` resolves an `ICustomerLoginResponse`
//     (success) or rejects with an `ApiError` (failure),
//   - a REAL `secureStore` (`createSecureStore`) over the in-memory fake adapter,
//   - a fake `authStore` recording `setSession`/`clear` and exposing `status`,
//   - a fake `queryClient` plus a `clearAccountScopedQueries` spy.
// No live backend, device keychain, or React tree is touched.
import { ERROR_CODES } from '@queuenow/shared-constants';
import type { ICustomerLoginResponse } from '@queuenow/shared-types';
import type { QueryClient } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';

// `auth-manager` statically pulls in `@/lib/api/client` (→ `@/lib/env` →
// `expo-constants`) and `@/lib/auth/secure-store` / `@/lib/auth/fingerprint`
// (→ `expo-secure-store` / `expo-crypto`). Those native packages ship Flow-typed
// source Vitest's transform cannot parse, and none of them are exercised here
// (the manager gets injected seams). Stub the native boundary so the REAL
// auth-manager + secure-store logic under test loads; nothing being asserted is faked.
vi.mock('expo-constants', () => ({ default: { expoConfig: { extra: {} } } }));
vi.mock('expo-secure-store', () => ({
  getItemAsync: vi.fn(),
  setItemAsync: vi.fn(),
  deleteItemAsync: vi.fn(),
}));
vi.mock('expo-crypto', () => ({ randomUUID: () => 'test-uuid' }));

import { ApiError, type ApiClient } from '@/lib/api/client';
import { createAuthManager, type AuthStoreLike } from '@/lib/auth/auth-manager';
import { createSecureStore, SECURE_STORE_KEYS } from '@/lib/auth/secure-store';
import { createInMemorySecureStore, type InMemorySecureStore } from '@/test-support';

const accessKey = SECURE_STORE_KEYS.accessToken;
const refreshKey = SECURE_STORE_KEYS.refreshToken;

// --- test doubles ----------------------------------------------------------

/** A fake in-memory session mirror that records `setSession`/`clear`. */
function createFakeAuthStore(): {
  store: AuthStoreLike;
  calls: { setSession: number; clear: number };
  status: () => 'unknown' | 'signed-in' | 'signed-out';
} {
  let status: 'unknown' | 'signed-in' | 'signed-out' = 'unknown';
  const calls = { setSession: 0, clear: 0 };
  const state = {
    get status() {
      return status;
    },
    setSession() {
      calls.setSession += 1;
      status = 'signed-in';
    },
    clear() {
      calls.clear += 1;
      status = 'signed-out';
    },
  };
  return { store: { getState: () => state }, calls, status: () => status };
}

/** A fake `apiClient` whose `post` resolves the login response or rejects. */
function buildApiClient(
  outcome: { kind: 'ok'; response: ICustomerLoginResponse } | { kind: 'error'; error: ApiError },
): { client: ApiClient; post: ReturnType<typeof vi.fn> } {
  const post = vi.fn(async () => {
    if (outcome.kind === 'error') {
      throw outcome.error;
    }
    return { data: outcome.response };
  });
  const notUsed = vi.fn(async () => {
    throw new Error('unexpected apiClient call');
  });
  const client = {
    request: notUsed,
    refreshAccessToken: notUsed,
    get: notUsed,
    post,
    patch: notUsed,
    delete: notUsed,
  } as unknown as ApiClient;
  return { client, post };
}

/** Read the durable contents of the adapter, bypassing read-failure injection. */
function storedTokens(adapter: InMemorySecureStore): { access: boolean; refresh: boolean } {
  adapter.setFailRead(false);
  return { access: adapter.has(accessKey), refresh: adapter.has(refreshKey) };
}

const customer: ICustomerLoginResponse['customer'] = {
  id: 'cust_1',
  email: 'alex@example.com',
  phone: '+1000000000',
  fullName: 'Alex Customer',
  avatarUrl: 'https://example.com/a.png',
};

const tokens = { accessToken: 'tok_access_123', refreshToken: 'tok_refresh_456' };
const loginResponse: ICustomerLoginResponse = { customer, tokens };

/** Wire a manager over fresh fakes; returns the manager and its seams for assertions. */
function setup(
  outcome: { kind: 'ok'; response: ICustomerLoginResponse } | { kind: 'error'; error: ApiError },
  adapterOptions: Parameters<typeof createInMemorySecureStore>[0] = {},
) {
  const adapter = createInMemorySecureStore(adapterOptions);
  const secureStore = createSecureStore(adapter);
  const auth = createFakeAuthStore();
  const clearAccountScopedQueries = vi.fn();
  const queryClient = {} as QueryClient;
  const { client, post } = buildApiClient(outcome);

  const manager = createAuthManager({
    apiClient: client,
    secureStore,
    authStore: auth.store,
    queryClient,
    clearAccountScopedQueries,
  });

  return { manager, adapter, auth, clearAccountScopedQueries, queryClient, post };
}

// --- login -----------------------------------------------------------------

describe('auth flow — login (R6.2, R6.3)', () => {
  it('login success calls POST /customers/login, write-confirms tokens, signs in, and returns the session', async () => {
    const { manager, adapter, auth, post } = setup({ kind: 'ok', response: loginResponse });

    const session = await manager.login({ email: 'alex@example.com', password: 'secret' });

    // Hit the documented customer login endpoint with the validated body.
    expect(post).toHaveBeenCalledTimes(1);
    expect(post).toHaveBeenCalledWith('/customers/login', {
      email: 'alex@example.com',
      password: 'secret',
    });

    // Tokens write-confirmed in secure storage; mirror flipped to signed-in.
    const stored = storedTokens(adapter);
    expect(stored.access).toBe(true);
    expect(stored.refresh).toBe(true);
    expect(adapter.snapshot()[accessKey]).toBe(tokens.accessToken);
    expect(adapter.snapshot()[refreshKey]).toBe(tokens.refreshToken);

    expect(manager.isSignedIn()).toBe(true);
    expect(auth.status()).toBe('signed-in');
    expect(auth.calls.setSession).toBe(1);
    expect(session).toEqual({ customer });
  });

  it('login failure (AUTH_INVALID_CREDENTIALS) throws, stores no token, and stays signed-out', async () => {
    const error = new ApiError(ERROR_CODES.AUTH_INVALID_CREDENTIALS, 'bad creds');
    const { manager, adapter, auth } = setup({ kind: 'error', error });

    await expect(manager.login({ email: 'alex@example.com', password: 'wrong' })).rejects.toBe(
      error,
    );

    // Backend rejection propagates BEFORE any token write → nothing persisted (R6.3).
    const stored = storedTokens(adapter);
    expect(stored.access).toBe(false);
    expect(stored.refresh).toBe(false);

    expect(manager.isSignedIn()).toBe(false);
    expect(auth.status()).not.toBe('signed-in');
    expect(auth.calls.setSession).toBe(0);
  });
});

// --- register --------------------------------------------------------------

describe('auth flow — register (R6.1)', () => {
  it('register success calls POST /customers/register, write-confirms tokens, and signs in', async () => {
    const { manager, adapter, auth, post } = setup({ kind: 'ok', response: loginResponse });

    const session = await manager.register({
      email: 'alex@example.com',
      fullName: 'Alex Customer',
      password: 'supersecret',
    });

    expect(post).toHaveBeenCalledTimes(1);
    expect(post).toHaveBeenCalledWith('/customers/register', {
      email: 'alex@example.com',
      fullName: 'Alex Customer',
      password: 'supersecret',
    });

    const stored = storedTokens(adapter);
    expect(stored.access).toBe(true);
    expect(stored.refresh).toBe(true);

    expect(manager.isSignedIn()).toBe(true);
    expect(auth.status()).toBe('signed-in');
    expect(auth.calls.setSession).toBe(1);
    expect(session).toEqual({ customer });
  });
});

// --- sign-out --------------------------------------------------------------

describe('auth flow — sign-out (R6.6)', () => {
  it('sign-out removes both tokens, clears the in-memory mirror, and drops account-scoped queries', async () => {
    const { manager, adapter, auth, clearAccountScopedQueries, queryClient } = setup(
      { kind: 'ok', response: loginResponse },
      { initial: { [accessKey]: tokens.accessToken, [refreshKey]: tokens.refreshToken } },
    );

    await manager.signOut();

    // Tokens deleted from secure storage.
    const stored = storedTokens(adapter);
    expect(stored.access).toBe(false);
    expect(stored.refresh).toBe(false);

    // In-memory session mirror cleared so account UI is gated immediately.
    expect(manager.isSignedIn()).toBe(false);
    expect(auth.status()).toBe('signed-out');
    expect(auth.calls.clear).toBe(1);

    // Account-scoped query data dropped on the injected query client (R6.6/R7.4).
    expect(clearAccountScopedQueries).toHaveBeenCalledTimes(1);
    expect(clearAccountScopedQueries).toHaveBeenCalledWith(queryClient);
  });
});
