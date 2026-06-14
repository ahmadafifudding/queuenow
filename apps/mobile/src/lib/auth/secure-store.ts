/**
 * Secure_Store — a thin, typed wrapper over `expo-secure-store` (R6.7, R6.8, R6.9).
 *
 * Tokens and the device fingerprint are persisted in the OS keychain/keystore via
 * `expo-secure-store` — never `AsyncStorage` or plain storage (R6.7). This module
 * provides read / write / delete plus a **write-with-confirmation** primitive
 * (write, then read back and compare) used by the Auth_Manager to guarantee a
 * token actually landed before the session is flipped to "signed in" (R6.8/R6.9).
 *
 * Testability: the underlying storage is accessed exclusively through the small
 * {@link SecureStoreAdapter} interface. The default export binds the real
 * `expo-secure-store` adapter, but `createSecureStore(adapter)` lets tests inject
 * an in-memory adapter (optionally with simulated read/write failures) so the
 * wrapper's logic — especially write-confirmation — is verified without a device
 * keychain.
 *
 * Note on keys: `expo-secure-store` only permits keys made of alphanumeric
 * characters, `.`, `-`, and `_`. The design's `secure:` notation is a namespace
 * label, not the literal stored key; the literal keys here are plain identifiers.
 */
import * as SecureStore from 'expo-secure-store';

/**
 * The fixed set of secure-store keys the app uses.
 *
 * - `accessToken` / `refreshToken` — customer session tokens (R6.7, R6.8).
 * - `deviceFingerprint` — stable anonymous device id (R2.3).
 * - `pushToken` — last-registered push token mirror (R13.1).
 */
export const SECURE_STORE_KEYS = {
  accessToken: 'accessToken',
  refreshToken: 'refreshToken',
  deviceFingerprint: 'deviceFingerprint',
  pushToken: 'pushToken',
} as const;

/** A valid secure-store key (one of {@link SECURE_STORE_KEYS}). */
export type SecureStoreKey = (typeof SECURE_STORE_KEYS)[keyof typeof SECURE_STORE_KEYS];

/**
 * The minimal async storage surface the wrapper depends on. `expo-secure-store`
 * satisfies this shape; tests provide an in-memory implementation.
 */
export interface SecureStoreAdapter {
  getItemAsync(key: string): Promise<string | null>;
  setItemAsync(key: string, value: string): Promise<void>;
  deleteItemAsync(key: string): Promise<void>;
}

/** The public surface returned by {@link createSecureStore}. */
export interface SecureStoreApi {
  /** Read a value, or `null` when absent. Rejects only if the adapter rejects. */
  read(key: SecureStoreKey): Promise<string | null>;
  /** Write a value. Rejects if the adapter rejects (e.g. storage unavailable). */
  write(key: SecureStoreKey, value: string): Promise<void>;
  /** Delete a value. Rejects only if the adapter rejects. */
  remove(key: SecureStoreKey): Promise<void>;
  /**
   * Write-with-confirmation (R6.8/R6.9): write the value, then read it back and
   * compare. Resolves `true` only when the read-back exactly matches the written
   * value. Any failure (storage unavailable on write or read, or a mismatched /
   * absent read-back) resolves `false` rather than rejecting, so callers can
   * treat a non-confirmed write as "remain signed out" without a try/catch.
   */
  writeConfirmed(key: SecureStoreKey, value: string): Promise<boolean>;
}

/** The real `expo-secure-store` adapter used in the running app. */
export const expoSecureStoreAdapter: SecureStoreAdapter = {
  getItemAsync: (key) => SecureStore.getItemAsync(key),
  setItemAsync: (key, value) => SecureStore.setItemAsync(key, value),
  deleteItemAsync: (key) => SecureStore.deleteItemAsync(key),
};

/**
 * Build a {@link SecureStoreApi} over the given adapter. Pure with respect to the
 * adapter — no module-level state — so it is fully deterministic in tests.
 *
 * @param adapter The storage backend. Defaults to the `expo-secure-store` adapter.
 */
export function createSecureStore(
  adapter: SecureStoreAdapter = expoSecureStoreAdapter,
): SecureStoreApi {
  const read: SecureStoreApi['read'] = (key) => adapter.getItemAsync(key);

  const write: SecureStoreApi['write'] = (key, value) => adapter.setItemAsync(key, value);

  const remove: SecureStoreApi['remove'] = (key) => adapter.deleteItemAsync(key);

  const writeConfirmed: SecureStoreApi['writeConfirmed'] = async (key, value) => {
    try {
      await adapter.setItemAsync(key, value);
      const readBack = await adapter.getItemAsync(key);
      return readBack === value;
    } catch {
      // Storage unavailable or threw mid-operation → treat as not-confirmed.
      return false;
    }
  };

  return { read, write, remove, writeConfirmed };
}

/**
 * The default secure store bound to `expo-secure-store`. Application code imports
 * this; tests construct their own via {@link createSecureStore} with an in-memory
 * adapter.
 */
export const secureStore: SecureStoreApi = createSecureStore();
