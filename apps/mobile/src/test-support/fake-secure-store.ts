/**
 * In-memory secure-store fake (boundary harness — task 2.4).
 *
 * Implements the production {@link SecureStoreAdapter} seam used by
 * `createSecureStore` (`src/lib/auth/secure-store.ts`) so the secure-token /
 * write-confirmation logic (Properties 14/15) can be exercised without a device
 * keychain. Storage is a plain `Map`; failures are injectable so tests can drive
 * the R6.9 "storage unavailable / read-back mismatch → remain signed out" paths.
 *
 * Pure with respect to time and randomness — fully deterministic in tests.
 */
import type { SecureStoreAdapter } from '@/lib/auth/secure-store';

/** Knobs that simulate a flaky/unavailable secure store. */
export interface InMemorySecureStoreOptions {
  /** Seed values present before the test runs. */
  initial?: Record<string, string>;
  /** When `true`, every `getItemAsync` rejects (storage unavailable on read). */
  failRead?: boolean;
  /** When `true`, every `setItemAsync` rejects (storage unavailable on write). */
  failWrite?: boolean;
  /** When `true`, every `deleteItemAsync` rejects. */
  failDelete?: boolean;
  /**
   * When `true`, writes are silently dropped so a subsequent read-back returns
   * the prior value (or `null`). Simulates a write that "succeeds" but does not
   * persist — exercising the write-confirmation mismatch branch (R6.9).
   */
  dropWrites?: boolean;
}

/** The in-memory adapter plus test controls/introspection. */
export interface InMemorySecureStore extends SecureStoreAdapter {
  /** Toggle read failure at runtime. */
  setFailRead(fail: boolean): void;
  /** Toggle write failure at runtime. */
  setFailWrite(fail: boolean): void;
  /** Toggle delete failure at runtime. */
  setFailDelete(fail: boolean): void;
  /** Toggle silent-write-drop at runtime. */
  setDropWrites(drop: boolean): void;
  /** Whether a key currently holds a value. */
  has(key: string): boolean;
  /** Immutable snapshot of the current contents (for assertions). */
  snapshot(): Record<string, string>;
  /** Number of times each operation was invoked (for assertions). */
  readonly calls: { get: number; set: number; delete: number };
}

/**
 * Build an in-memory {@link SecureStoreAdapter} for tests. Pass it to the
 * production `createSecureStore(adapter)` to get a real `SecureStoreApi` backed
 * by memory, or use it directly.
 */
export function createInMemorySecureStore(
  options: InMemorySecureStoreOptions = {},
): InMemorySecureStore {
  const store = new Map<string, string>(Object.entries(options.initial ?? {}));
  let failRead = options.failRead ?? false;
  let failWrite = options.failWrite ?? false;
  let failDelete = options.failDelete ?? false;
  let dropWrites = options.dropWrites ?? false;
  const calls = { get: 0, set: 0, delete: 0 };

  return {
    calls,

    async getItemAsync(key) {
      calls.get += 1;
      if (failRead) {
        throw new Error('secure-store: read failed');
      }
      return store.get(key) ?? null;
    },

    async setItemAsync(key, value) {
      calls.set += 1;
      if (failWrite) {
        throw new Error('secure-store: write failed');
      }
      if (!dropWrites) {
        store.set(key, value);
      }
    },

    async deleteItemAsync(key) {
      calls.delete += 1;
      if (failDelete) {
        throw new Error('secure-store: delete failed');
      }
      store.delete(key);
    },

    setFailRead(fail) {
      failRead = fail;
    },
    setFailWrite(fail) {
      failWrite = fail;
    },
    setFailDelete(fail) {
      failDelete = fail;
    },
    setDropWrites(drop) {
      dropWrites = drop;
    },
    has(key) {
      return store.has(key);
    },
    snapshot() {
      return Object.fromEntries(store.entries());
    },
  };
}
