/**
 * In-memory AsyncStorage fake (boundary harness — task 2.4).
 *
 * Implements the production {@link AsyncStorageAdapter} seam from
 * `src/lib/api/persist.ts` so the read-only offline active-ticket cache
 * (Property 18, task 5.3) can round-trip without a device. Failures and a
 * corrupt-value injection are supported to exercise the "no usable cache"
 * fallbacks (missing / unparseable / storage-unavailable).
 */
import type { AsyncStorageAdapter } from '@/lib/api/persist';

/** Knobs that simulate a flaky/unavailable AsyncStorage. */
export interface InMemoryAsyncStorageOptions {
  /** Seed values present before the test runs. */
  initial?: Record<string, string>;
  /** When `true`, every `getItem` rejects (storage unavailable on read). */
  failRead?: boolean;
  /** When `true`, every `setItem` rejects (storage unavailable on write). */
  failWrite?: boolean;
  /** When `true`, every `removeItem` rejects. */
  failRemove?: boolean;
}

/** The in-memory adapter plus test controls/introspection. */
export interface InMemoryAsyncStorage extends AsyncStorageAdapter {
  /** Toggle read failure at runtime. */
  setFailRead(fail: boolean): void;
  /** Toggle write failure at runtime. */
  setFailWrite(fail: boolean): void;
  /** Directly seed a raw (possibly corrupt) value for a key. */
  seed(key: string, value: string): void;
  /** Immutable snapshot of the current contents (for assertions). */
  snapshot(): Record<string, string>;
}

/** Build an in-memory {@link AsyncStorageAdapter} for tests. */
export function createInMemoryAsyncStorage(
  options: InMemoryAsyncStorageOptions = {},
): InMemoryAsyncStorage {
  const store = new Map<string, string>(Object.entries(options.initial ?? {}));
  let failRead = options.failRead ?? false;
  let failWrite = options.failWrite ?? false;
  let failRemove = options.failRemove ?? false;

  return {
    async getItem(key) {
      if (failRead) {
        throw new Error('async-storage: read failed');
      }
      return store.get(key) ?? null;
    },
    async setItem(key, value) {
      if (failWrite) {
        throw new Error('async-storage: write failed');
      }
      store.set(key, value);
    },
    async removeItem(key) {
      if (failRemove) {
        throw new Error('async-storage: remove failed');
      }
      store.delete(key);
    },
    setFailRead(fail) {
      failRead = fail;
    },
    setFailWrite(fail) {
      failWrite = fail;
    },
    seed(key, value) {
      store.set(key, value);
    },
    snapshot() {
      return Object.fromEntries(store.entries());
    },
  };
}
