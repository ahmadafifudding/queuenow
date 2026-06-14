// Feature: customer-mobile-app, Property 14: Secure-token write-confirmation invariant
//
// Validates: Requirements 6.1, 6.2, 6.3, 6.6, 6.7, 6.8, 6.9
//
// For any token pair, after register/login the session is treated as "signed in"
// IFF a read-back from secure storage returns the same tokens; if the write or
// read-back fails (or secure storage is unavailable), the session remains
// signed-out, an error is surfaced, and the store holds no tokens. After
// sign-out, and after any failed authentication, the secure store holds no
// tokens.
//
// The Auth_Manager is exercised through its injectable seams (`createAuthManager`):
//   - a fake `apiClient` whose `post` resolves a generated `ICustomerLoginResponse`
//     (success) or rejects with an `ApiError` (failed-auth case),
//   - a REAL `secureStore` (`createSecureStore`) built over the in-memory fake
//     adapter, with write-success / storage-unavailable / read-back-mismatch
//     toggled via the adapter's failure injection,
//   - a fake `authStore` that records `setSession`/`clear` and exposes `status`,
//   - a fake `queryClient` plus a `clearAccountScopedQueries` spy.
// No live backend, device keychain, or React tree is touched.
import { ERROR_CODES } from '@queuenow/shared-constants';
import type { ICustomerLoginResponse } from '@queuenow/shared-types';
import type { CustomerRegisterInput, LoginInput } from '@queuenow/shared-validation';
import type { QueryClient } from '@tanstack/react-query';
import fc from 'fast-check';
import { describe, expect, it, vi } from 'vitest';

// `auth-manager` statically pulls in `@/lib/api/client` (→ `@/lib/env` →
// `expo-constants`) and `@/lib/auth/secure-store` / `@/lib/auth/fingerprint`
// (→ `expo-secure-store` / `expo-crypto`). Those native packages ship Flow-typed
// source Vitest's transform cannot parse, and none of them are exercised by this
// property (the manager gets injected seams). Stub the native boundary so the
// REAL auth-manager + secure-store logic under test loads; nothing about the
// write-confirmation behavior is faked.
vi.mock('expo-constants', () => ({ default: { expoConfig: { extra: {} } } }));
vi.mock('expo-secure-store', () => ({
  getItemAsync: vi.fn(),
  setItemAsync: vi.fn(),
  deleteItemAsync: vi.fn(),
}));
vi.mock('expo-crypto', () => ({ randomUUID: () => 'test-uuid' }));

import { ApiError, type ApiClient } from '@/lib/api/client';
import {
  createAuthManager,
  type AuthStoreLike,
  type CustomerSession,
} from '@/lib/auth/auth-manager';
import { createSecureStore, SECURE_STORE_KEYS } from '@/lib/auth/secure-store';
import { createInMemorySecureStore, type InMemorySecureStore } from '@/test-support';

// --- arbitraries -----------------------------------------------------------

/** A non-empty token string (the realistic shape of an access/refresh token). */
const tokenArb: fc.Arbitrary<string> = fc
  .string({ minLength: 1, maxLength: 40 })
  .map((s) => `tok_${s}`);

/**
 * An email that satisfies the shared `loginSchema`/`customerRegisterSchema`
 * `.email()` validation. `fc.emailAddress()` emits RFC-valid addresses (e.g.
 * `!a@a.aa`) that zod's stricter regex rejects; this property exercises the
 * post-validation write-confirmation logic, so inputs must pass validation
 * first. Constrained to a simple `local@domain.tld` shape that zod accepts.
 */
const emailLabelArb: fc.Arbitrary<string> = fc.stringMatching(/^[a-z0-9]{1,12}$/);
const safeEmailArb: fc.Arbitrary<string> = fc
  .tuple(emailLabelArb, emailLabelArb, fc.constantFrom('com', 'net', 'io', 'dev'))
  .map(([local, domain, tld]) => `${local}@${domain}.${tld}`);

/** A generated token pair; the two values are independent. */
const tokenPairArb = fc.record({
  accessToken: tokenArb,
  refreshToken: tokenArb,
});

/** A customer profile as returned by register/login (no tokens held in memory). */
const customerArb: fc.Arbitrary<ICustomerLoginResponse['customer']> = fc.record({
  id: fc.string({ minLength: 1, maxLength: 12 }).map((s) => `cust_${s}`),
  email: safeEmailArb,
  phone: fc.string({ minLength: 1, maxLength: 12 }),
  fullName: fc.string({ minLength: 2, maxLength: 20 }),
  avatarUrl: fc.webUrl(),
});

/**
 * How secure storage behaves on this run:
 *  - `ok`    : writes land and read back → confirmed (signed-in path),
 *  - `write` : every write rejects (storage unavailable on write),
 *  - `read`  : every read-back rejects (storage unavailable on read),
 *  - `drop`  : writes are silently dropped → read-back mismatch (R6.9).
 */
type StorageMode = 'ok' | 'write' | 'read' | 'drop';

const storageModeArb: fc.Arbitrary<StorageMode> = fc.constantFrom('ok', 'write', 'read', 'drop');

/** Which auth entry point to drive, with matching valid input (passes validation). */
type AuthCall =
  | { method: 'register'; input: CustomerRegisterInput }
  | { method: 'login'; input: LoginInput };

const registerCallArb: fc.Arbitrary<AuthCall> = fc
  .record({
    password: fc.string({ minLength: 8, maxLength: 24 }),
    email: fc.option(safeEmailArb, { nil: undefined }),
  })
  .map((input) => ({ method: 'register', input }));

const loginCallArb: fc.Arbitrary<AuthCall> = fc
  .record({
    email: safeEmailArb,
    password: fc.string({ minLength: 1, maxLength: 24 }),
  })
  .map((input) => ({ method: 'login', input }));

const authCallArb: fc.Arbitrary<AuthCall> = fc.oneof(registerCallArb, loginCallArb);

// --- test doubles ----------------------------------------------------------

/** A fake in-memory session mirror that records `setSession`/`clear`. */
function createFakeAuthStore(): {
  store: AuthStoreLike;
  calls: { setSession: number; clear: number };
  status: () => 'unknown' | 'signed-in' | 'signed-out';
} {
  let status: 'unknown' | 'signed-in' | 'signed-out' = 'unknown';
  let customer: ICustomerLoginResponse['customer'] | null = null;
  const calls = { setSession: 0, clear: 0 };
  const state = {
    get status() {
      return status;
    },
    setSession(c: ICustomerLoginResponse['customer']) {
      calls.setSession += 1;
      customer = c;
      status = 'signed-in';
    },
    clear() {
      calls.clear += 1;
      customer = null;
      status = 'signed-out';
    },
  };
  void customer; // retained for shape parity; assertions key off status/calls
  return { store: { getState: () => state }, calls, status: () => status };
}

/** Build an adapter (via the harness) configured for the given storage mode. */
function buildAdapter(mode: StorageMode): InMemorySecureStore {
  return createInMemorySecureStore({
    failWrite: mode === 'write',
    failRead: mode === 'read',
    dropWrites: mode === 'drop',
  });
}

/** A fake `apiClient` whose `post` resolves the login response or rejects. */
function buildApiClient(
  outcome: { kind: 'ok'; response: ICustomerLoginResponse } | { kind: 'error'; error: ApiError },
): ApiClient {
  const post = vi.fn(async () => {
    if (outcome.kind === 'error') {
      throw outcome.error;
    }
    return { data: outcome.response };
  });
  // Only `post` is used by the Auth_Manager; the rest satisfy the type surface.
  const notUsed = vi.fn(async () => {
    throw new Error('unexpected apiClient call');
  });
  return {
    request: notUsed,
    refreshAccessToken: notUsed,
    get: notUsed,
    post,
    patch: notUsed,
    delete: notUsed,
  } as unknown as ApiClient;
}

const accessKey = SECURE_STORE_KEYS.accessToken;
const refreshKey = SECURE_STORE_KEYS.refreshToken;

/** Read the durable contents of the adapter, bypassing failure injection. */
function storedTokens(adapter: InMemorySecureStore): { access: boolean; refresh: boolean } {
  adapter.setFailRead(false);
  return { access: adapter.has(accessKey), refresh: adapter.has(refreshKey) };
}

// --- property: register/login write-confirmation ---------------------------

describe('Property 14: Secure-token write-confirmation invariant', () => {
  it('signs in IFF both tokens read back; otherwise stays signed-out, surfaces an error, and persists no tokens', async () => {
    await fc.assert(
      fc.asyncProperty(
        authCallArb,
        tokenPairArb,
        customerArb,
        storageModeArb,
        fc.boolean(),
        async (call, tokens, customer, storageMode, authFails) => {
          const adapter = buildAdapter(storageMode);
          const secureStore = createSecureStore(adapter);
          const auth = createFakeAuthStore();
          const clearAccountScopedQueries = vi.fn();
          const queryClient = {} as QueryClient;

          const response: ICustomerLoginResponse = { customer, tokens };
          const apiClient = buildApiClient(
            authFails
              ? {
                  kind: 'error',
                  error: new ApiError(ERROR_CODES.AUTH_INVALID_CREDENTIALS, 'bad creds'),
                }
              : { kind: 'ok', response },
          );

          const manager = createAuthManager({
            apiClient,
            secureStore,
            authStore: auth.store,
            queryClient,
            clearAccountScopedQueries,
          });

          let session: CustomerSession | undefined;
          let thrown: unknown;
          try {
            session =
              call.method === 'register'
                ? await manager.register(call.input)
                : await manager.login(call.input);
          } catch (error) {
            thrown = error;
          }

          const stored = storedTokens(adapter);
          const confirmable = !authFails && storageMode === 'ok';

          if (confirmable) {
            // Success + read-back confirmed → signed-in, both tokens persisted,
            // session returned, mirror flipped exactly once, no error (R6.1/6.2/6.8).
            expect(thrown).toBeUndefined();
            expect(session).toEqual({ customer });
            expect(manager.isSignedIn()).toBe(true);
            expect(auth.status()).toBe('signed-in');
            expect(auth.calls.setSession).toBe(1);
            expect(stored.access).toBe(true);
            expect(stored.refresh).toBe(true);
          } else {
            // Failed auth OR unconfirmed write/read-back → NOT signed-in, an error
            // is surfaced, the mirror is never flipped, and NO tokens remain — any
            // partial token written before the failure is removed (R6.3/6.7/6.9).
            expect(thrown).toBeInstanceOf(ApiError);
            expect(manager.isSignedIn()).toBe(false);
            expect(auth.status()).not.toBe('signed-in');
            expect(auth.calls.setSession).toBe(0);
            expect(stored.access).toBe(false);
            expect(stored.refresh).toBe(false);
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  // --- property: sign-out clears tokens, mirror, and account-scoped queries ---

  it('sign-out removes both tokens, clears the in-memory mirror, and drops account-scoped queries', async () => {
    await fc.assert(
      fc.asyncProperty(tokenPairArb, fc.boolean(), async (tokens, failDelete) => {
        // Seed a "signed-in" device: both tokens already in secure storage.
        const adapter = createInMemorySecureStore({
          initial: { [accessKey]: tokens.accessToken, [refreshKey]: tokens.refreshToken },
          // A flaky delete must not leave the session "signed in"; removal is
          // best-effort but the mirror + account data are always cleared (R6.6/7.4).
          failDelete,
        });
        const secureStore = createSecureStore(adapter);
        const auth = createFakeAuthStore();
        const clearAccountScopedQueries = vi.fn();
        const queryClient = {} as QueryClient;

        const manager = createAuthManager({
          secureStore,
          authStore: auth.store,
          queryClient,
          clearAccountScopedQueries,
        });

        await manager.signOut();

        expect(manager.isSignedIn()).toBe(false);
        expect(auth.status()).toBe('signed-out');
        expect(auth.calls.clear).toBe(1);
        // Account-scoped query data is dropped on the injected query client (R7.4).
        expect(clearAccountScopedQueries).toHaveBeenCalledTimes(1);
        expect(clearAccountScopedQueries).toHaveBeenCalledWith(queryClient);

        if (!failDelete) {
          const stored = storedTokens(adapter);
          expect(stored.access).toBe(false);
          expect(stored.refresh).toBe(false);
        }
      }),
      { numRuns: 100 },
    );
  });
});
