/**
 * Auth_Manager (`lib/auth/auth-manager.ts`) — the single entry point for the
 * optional customer account lifecycle (Requirements 6 + 7.4).
 *
 * It orchestrates the already-built seams rather than re-implementing them:
 * - `apiClient` (REST) for `POST /customers/register` / `POST /customers/login`,
 * - `secure-store` for write-confirmed token persistence (R6.7–R6.9),
 * - `auth-store` (Zustand in-memory mirror) for the coarse signed-in status,
 * - `fingerprint` for the stable anonymous device id (R2.3),
 * - `invalidation.clearAccountScopedQueries` to drop account data on sign-out (R7.4).
 *
 * Token-handling invariants (the heart of this module):
 * - **Validate before sending** (R6.10): account input is parsed with the shared
 *   `customerRegisterSchema` / `loginSchema`. Invalid input throws a typed
 *   `VALIDATION_ERROR` and NEVER reaches the network.
 * - **Write-confirm before "signed in"** (R6.8/R6.9): after a successful
 *   register/login, BOTH tokens are written and read back (`writeConfirmed`)
 *   BEFORE the in-memory mirror is flipped to "signed in". If either write is not
 *   confirmed (secure storage unavailable / mismatched read-back), any partial
 *   token is removed, the mirror stays signed-out, and an error is surfaced — no
 *   partial session.
 * - **No token on failed auth** (R6.3): an `ApiError` from the backend (e.g.
 *   `AUTH_INVALID_CREDENTIALS`) propagates before any write, so nothing is
 *   persisted.
 * - **Sign-out cleanup** (R6.6/R7.4): both tokens are deleted from secure storage,
 *   the in-memory mirror is cleared, and account-scoped query data is removed.
 *
 * Testability: every boundary is injected through {@link AuthManagerDeps}, so the
 * 4.x property tests drive register/login/sign-out without a device keychain,
 * a live backend, or a real React tree. The default {@link authManager} binds the
 * real REST client, secure store, auth store, query client, and fingerprint.
 */
import { ERROR_CODES } from '@queuenow/shared-constants';
import type { ICustomerLoginResponse } from '@queuenow/shared-types';
import {
  customerRegisterSchema,
  loginSchema,
  type CustomerRegisterInput,
  type LoginInput,
} from '@queuenow/shared-validation';
import type { QueryClient } from '@tanstack/react-query';

import { ApiError, apiClient as defaultApiClient, type ApiClient } from '@/lib/api/client';
import { clearAccountScopedQueries as defaultClearAccountScopedQueries } from '@/lib/api/invalidation';
import { queryClient as defaultQueryClient } from '@/lib/api/query-client';
import { authStore as defaultAuthStore } from '@/lib/auth/auth-store';
import { getDeviceFingerprint as defaultGetDeviceFingerprint } from '@/lib/auth/fingerprint';
import {
  SECURE_STORE_KEYS,
  secureStore as defaultSecureStore,
  type SecureStoreApi,
} from '@/lib/auth/secure-store';

/** Backend paths for the customer account endpoints (consumed verbatim). */
const REGISTER_PATH = '/customers/register';
const LOGIN_PATH = '/customers/login';

/** The customer profile as returned by register/login (no tokens held in memory). */
export type CustomerSession = {
  customer: ICustomerLoginResponse['customer'];
};

/**
 * The minimal in-memory session mirror the manager drives. Matches the vanilla
 * accessor exported by `auth-store.ts` (`authStore`); injectable for tests.
 */
export interface AuthStoreLike {
  getState(): {
    status: 'unknown' | 'signed-in' | 'signed-out';
    setSession(customer: ICustomerLoginResponse['customer']): void;
    clear(): void;
  };
}

/** Removes account-scoped query data on sign-out (R7.4). Injectable for tests. */
export type ClearAccountScopedQueries = (queryClient: QueryClient) => void;

/** Resolves the stable anonymous device fingerprint (R2.3). Injectable for tests. */
export type GetDeviceFingerprint = () => Promise<string>;

/** Dependencies for {@link createAuthManager}; all optional with real defaults. */
export interface AuthManagerDeps {
  /** REST client used for register/login. Defaults to the shared {@link apiClient}. */
  apiClient?: ApiClient;
  /** Secure storage for tokens. Defaults to the `expo-secure-store` wrapper. */
  secureStore?: SecureStoreApi;
  /** In-memory session mirror. Defaults to the shared `authStore`. */
  authStore?: AuthStoreLike;
  /** Query client whose account-scoped data is dropped on sign-out. */
  queryClient?: QueryClient;
  /** Removal helper for account-scoped queries. Defaults to the shared helper. */
  clearAccountScopedQueries?: ClearAccountScopedQueries;
  /** Stable device fingerprint resolver. Defaults to the fingerprint module. */
  getDeviceFingerprint?: GetDeviceFingerprint;
}

/** The public Auth_Manager surface (see design "Auth Manager"). */
export interface AuthManager {
  /** Register a customer account, persist tokens (write-confirmed), then sign in. */
  register(input: CustomerRegisterInput): Promise<CustomerSession>;
  /** Sign in an existing customer, persist tokens (write-confirmed), then sign in. */
  login(input: LoginInput): Promise<CustomerSession>;
  /** Sign out: delete tokens, clear the in-memory mirror, drop account-scoped data. */
  signOut(): Promise<void>;
  /** Read the current access token from secure storage (or `null`). */
  getAccessToken(): Promise<string | null>;
  /** Resolve the stable anonymous device fingerprint. */
  getDeviceFingerprint(): Promise<string>;
  /** Coarse signed-in status from the in-memory mirror. */
  isSignedIn(): boolean;
}

/**
 * Build an {@link AuthManager} over the given dependencies. Holds no module-level
 * state, so tests are fully isolated. The default {@link authManager} is one such
 * instance bound to the real seams.
 */
export function createAuthManager(deps: AuthManagerDeps = {}): AuthManager {
  const api = deps.apiClient ?? defaultApiClient;
  const store = deps.secureStore ?? defaultSecureStore;
  const auth = deps.authStore ?? defaultAuthStore;
  const queryClient = deps.queryClient ?? defaultQueryClient;
  const clearAccountScopedQueries =
    deps.clearAccountScopedQueries ?? defaultClearAccountScopedQueries;
  const getFingerprint = deps.getDeviceFingerprint ?? defaultGetDeviceFingerprint;

  /**
   * Best-effort removal of both tokens. Used to undo a partial write so a failed
   * register/login never leaves a half-persisted session behind (R6.9).
   */
  async function removeTokens(): Promise<void> {
    try {
      await store.remove(SECURE_STORE_KEYS.accessToken);
    } catch {
      // ignore — best-effort cleanup
    }
    try {
      await store.remove(SECURE_STORE_KEYS.refreshToken);
    } catch {
      // ignore — best-effort cleanup
    }
  }

  /**
   * Persist BOTH tokens with read-back confirmation, then flip the in-memory
   * mirror to "signed in" — but only if both writes were confirmed (R6.8/R6.9).
   * On any non-confirmed write, removes the partial token and throws so the
   * caller stays signed-out.
   */
  async function persistSessionOrThrow(response: ICustomerLoginResponse): Promise<CustomerSession> {
    const { accessToken, refreshToken } = response.tokens;

    const accessConfirmed = await store.writeConfirmed(SECURE_STORE_KEYS.accessToken, accessToken);
    const refreshConfirmed = await store.writeConfirmed(
      SECURE_STORE_KEYS.refreshToken,
      refreshToken,
    );

    if (!accessConfirmed || !refreshConfirmed) {
      // Storage unavailable or a write could not be confirmed → no partial
      // session. Undo any token that did land and remain signed-out (R6.9).
      await removeTokens();
      throw new ApiError(
        ERROR_CODES.INTERNAL_ERROR,
        'Your session could not be saved securely on this device. Please try again.',
      );
    }

    // Both tokens confirmed in secure storage → safe to flip to "signed in".
    auth.getState().setSession(response.customer);
    return { customer: response.customer };
  }

  async function register(input: CustomerRegisterInput): Promise<CustomerSession> {
    // R6.10: validate before sending — invalid input never reaches the network.
    const parsed = customerRegisterSchema.safeParse(input);
    if (!parsed.success) {
      throw new ApiError(
        ERROR_CODES.VALIDATION_ERROR,
        'Please check the highlighted fields and try again.',
        { issues: parsed.error.flatten() },
      );
    }

    // A backend error (e.g. AUTH_EMAIL_EXISTS / CUSTOMER_EMAIL_EXISTS) propagates
    // here BEFORE any token write, so nothing is persisted (R6.3 spirit).
    const { data } = await api.post<ICustomerLoginResponse>(REGISTER_PATH, parsed.data);
    return persistSessionOrThrow(data);
  }

  async function login(input: LoginInput): Promise<CustomerSession> {
    // R6.10: validate before sending.
    const parsed = loginSchema.safeParse(input);
    if (!parsed.success) {
      throw new ApiError(
        ERROR_CODES.VALIDATION_ERROR,
        'Please check the highlighted fields and try again.',
        { issues: parsed.error.flatten() },
      );
    }

    // On invalid credentials the backend throws AUTH_INVALID_CREDENTIALS, which
    // propagates before any write → no token stored (R6.3).
    const { data } = await api.post<ICustomerLoginResponse>(LOGIN_PATH, parsed.data);
    return persistSessionOrThrow(data);
  }

  async function signOut(): Promise<void> {
    // R6.6: remove both tokens from secure storage.
    await removeTokens();
    // Clear the in-memory mirror so account UI is gated immediately.
    auth.getState().clear();
    // R7.4: drop account-scoped query data so no account data survives the session.
    clearAccountScopedQueries(queryClient);
  }

  function getAccessToken(): Promise<string | null> {
    return store.read(SECURE_STORE_KEYS.accessToken);
  }

  function getDeviceFingerprint(): Promise<string> {
    return getFingerprint();
  }

  function isSignedIn(): boolean {
    return auth.getState().status === 'signed-in';
  }

  return {
    register,
    login,
    signOut,
    getAccessToken,
    getDeviceFingerprint,
    isSignedIn,
  };
}

/**
 * The default Auth_Manager, bound to the real REST client, secure store, auth
 * store, query client, and fingerprint. Feature code/screens use this; tests
 * construct isolated instances via {@link createAuthManager}.
 */
export const authManager: AuthManager = createAuthManager();
