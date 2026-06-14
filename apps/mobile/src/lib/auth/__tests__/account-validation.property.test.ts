// Feature: customer-mobile-app, Property 16: Account input validates against the shared schema before sending
//
// Validates: Requirements 6.10
//
// For any account input, the register/login request is sent IFF the corresponding
// shared schema (`customerRegisterSchema` / `loginSchema`) validates it; invalid
// input never reaches the network.
//
// The shared schemas are used as the ORACLE: for each generated input we compute
// `schema.safeParse(input).success` and assert that the fake `apiClient.post` was
// called IFF that oracle is `true`. For schema-valid inputs the fake REST client
// resolves a token pair and the (real) secure store confirms the write so
// register/login completes and returns a session. For schema-invalid inputs we
// assert the manager throws a `VALIDATION_ERROR` `ApiError` and `apiClient.post`
// was NEVER called. Both `register` and `login` are covered.
//
// The Auth_Manager is exercised through its injectable seams (`createAuthManager`):
//   - a fake `apiClient` whose `post` is a `vi.fn` recording whether it was hit,
//   - a REAL `secureStore` (`createSecureStore`) over the in-memory fake adapter
//     (write-confirmable, so valid inputs reach a clean signed-in state),
//   - a fake `authStore` recording `setSession`/`clear`,
//   - a fake `queryClient` plus a `clearAccountScopedQueries` spy.
// No live backend, device keychain, or React tree is touched.
import { ERROR_CODES } from '@queuenow/shared-constants';
import type { ICustomerLoginResponse } from '@queuenow/shared-types';
import {
  customerRegisterSchema,
  loginSchema,
  type CustomerRegisterInput,
  type LoginInput,
} from '@queuenow/shared-validation';
import type { QueryClient } from '@tanstack/react-query';
import fc from 'fast-check';
import { describe, expect, it, vi } from 'vitest';

// `auth-manager` statically pulls in `@/lib/api/client` (→ `@/lib/env` →
// `expo-constants`) and `@/lib/auth/secure-store` / `@/lib/auth/fingerprint`
// (→ `expo-secure-store` / `expo-crypto`). Those native packages ship Flow-typed
// source Vitest's transform cannot parse, and none of them are exercised by this
// property (the manager gets injected seams). Stub the native boundary so the
// REAL auth-manager + secure-store logic under test loads; nothing about the
// validate-before-send behavior is faked.
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
import { createInMemorySecureStore } from '@/test-support';

// --- arbitraries -----------------------------------------------------------
//
// Each field arbitrary deliberately straddles the schema boundary so the 100
// runs exercise BOTH the valid (request sent) and invalid (blocked) branches.

/** A non-empty token string (the realistic shape of an access/refresh token). */
const tokenArb: fc.Arbitrary<string> = fc
  .string({ minLength: 1, maxLength: 40 })
  .map((s) => `tok_${s}`);

/** A generated token pair returned by the fake REST client on a sent request. */
const tokenPairArb = fc.record({ accessToken: tokenArb, refreshToken: tokenArb });

/** A customer profile as returned by register/login. */
const customerArb: fc.Arbitrary<ICustomerLoginResponse['customer']> = fc.record({
  id: fc.string({ minLength: 1, maxLength: 12 }).map((s) => `cust_${s}`),
  email: fc.emailAddress(),
  phone: fc.string({ minLength: 1, maxLength: 12 }),
  fullName: fc.string({ minLength: 2, maxLength: 20 }),
  avatarUrl: fc.webUrl(),
});

/** An email slot: valid address, an arbitrary (often invalid) string, or absent. */
const emailSlotArb = fc.oneof(
  fc.emailAddress(),
  fc.string({ maxLength: 20 }),
  fc.constant(undefined),
);

/** A register password: valid (≥8), too short (<8), or absent (→ invalid). */
const registerPasswordArb = fc.oneof(
  fc.string({ minLength: 8, maxLength: 24 }),
  fc.string({ maxLength: 7 }),
  fc.constant(undefined),
);

/** A full name: valid (≥2), too short (1 char), or absent (optional → valid). */
const fullNameSlotArb = fc.oneof(
  fc.string({ minLength: 2, maxLength: 20 }),
  fc.string({ minLength: 1, maxLength: 1 }),
  fc.constant(undefined),
);

/** A phone slot: an arbitrary string or absent (both valid; field is optional). */
const phoneSlotArb = fc.oneof(fc.string({ maxLength: 15 }), fc.constant(undefined));

/** A login password: present (≥1), empty (→ invalid), or absent (→ invalid). */
const loginPasswordArb = fc.oneof(
  fc.string({ minLength: 1, maxLength: 24 }),
  fc.constant(''),
  fc.constant(undefined),
);

type AuthCall = { method: 'register' | 'login'; input: Record<string, unknown> };

/** Register inputs spanning the `customerRegisterSchema` boundary. */
const registerCallArb: fc.Arbitrary<AuthCall> = fc
  .record({
    email: emailSlotArb,
    phone: phoneSlotArb,
    fullName: fullNameSlotArb,
    password: registerPasswordArb,
  })
  .map((input) => ({ method: 'register', input }));

/** Login inputs spanning the `loginSchema` boundary. */
const loginCallArb: fc.Arbitrary<AuthCall> = fc
  .record({
    email: emailSlotArb,
    password: loginPasswordArb,
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

/**
 * A fake `apiClient` whose `post` RECORDS whether it was called and resolves the
 * generated login response. The recorded `post` mock is the network-reached
 * witness the property asserts on.
 */
function buildRecordingApiClient(response: ICustomerLoginResponse): {
  apiClient: ApiClient;
  post: ReturnType<typeof vi.fn>;
} {
  const post = vi.fn(async () => ({ data: response }));
  const notUsed = vi.fn(async () => {
    throw new Error('unexpected apiClient call');
  });
  const apiClient = {
    request: notUsed,
    refreshAccessToken: notUsed,
    get: notUsed,
    post,
    patch: notUsed,
    delete: notUsed,
  } as unknown as ApiClient;
  return { apiClient, post };
}

const accessKey = SECURE_STORE_KEYS.accessToken;
const refreshKey = SECURE_STORE_KEYS.refreshToken;

// --- property --------------------------------------------------------------

describe('Property 16: Account input validates against the shared schema before sending', () => {
  it('sends the register/login request IFF the shared schema validates the input; invalid input never reaches the network', async () => {
    await fc.assert(
      fc.asyncProperty(authCallArb, tokenPairArb, customerArb, async (call, tokens, customer) => {
        // Oracle: the SAME shared schema the manager validates against.
        const schema = call.method === 'register' ? customerRegisterSchema : loginSchema;
        const expectedSent = schema.safeParse(call.input).success;

        // Write-confirmable secure store so a sent (valid) request can complete.
        const adapter = createInMemorySecureStore();
        const secureStore = createSecureStore(adapter);
        const auth = createFakeAuthStore();
        const clearAccountScopedQueries = vi.fn();
        const queryClient = {} as QueryClient;

        const response: ICustomerLoginResponse = { customer, tokens };
        const { apiClient, post } = buildRecordingApiClient(response);

        const manager = createAuthManager({
          apiClient,
          secureStore,
          authStore: auth.store,
          queryClient,
          clearAccountScopedQueries,
        });

        let thrown: unknown;
        try {
          if (call.method === 'register') {
            await manager.register(call.input as unknown as CustomerRegisterInput);
          } else {
            await manager.login(call.input as unknown as LoginInput);
          }
        } catch (error) {
          thrown = error;
        }

        // The core IFF: the network was reached exactly when the schema validates.
        expect(post.mock.calls.length).toBe(expectedSent ? 1 : 0);

        if (expectedSent) {
          // Valid input → request sent, session persisted + signed in, no throw.
          expect(thrown).toBeUndefined();
          expect(manager.isSignedIn()).toBe(true);
          expect(auth.status()).toBe('signed-in');
          expect(adapter.has(accessKey)).toBe(true);
          expect(adapter.has(refreshKey)).toBe(true);
        } else {
          // Invalid input → blocked before the network with a VALIDATION_ERROR,
          // no session, no tokens persisted.
          expect(thrown).toBeInstanceOf(ApiError);
          expect((thrown as ApiError).code).toBe(ERROR_CODES.VALIDATION_ERROR);
          expect(manager.isSignedIn()).toBe(false);
          expect(auth.status()).not.toBe('signed-in');
          expect(adapter.has(accessKey)).toBe(false);
          expect(adapter.has(refreshKey)).toBe(false);
        }
      }),
      { numRuns: 100 },
    );
  });
});
