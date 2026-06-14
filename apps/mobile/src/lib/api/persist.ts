/**
 * Active-ticket offline cache persistence (`persist.ts`) — R9.1, R9.2.
 *
 * On every successful Active_Ticket load the app persists the ticket's
 * last-known details to device storage so the tracking screen can render them
 * while offline, alongside a "may be out of date" indicator (R9.2). The cache is
 * strictly READ-ONLY application data: it never carries secrets and we never
 * mutate server state from it. It is therefore stored with `AsyncStorage`
 * (`@react-native-async-storage/async-storage`) — NOT `expo-secure-store`, which
 * is reserved for tokens and the device fingerprint (R6.7).
 *
 * Testability: all storage access goes through the small
 * {@link AsyncStorageAdapter} interface. The default binds the real
 * `AsyncStorage`, but {@link createActiveTicketCache} accepts an injected
 * adapter so tests can use an in-memory store (optionally simulating
 * read/write/parse failures) without a device. The read/write/clear functions
 * are otherwise pure with respect to the adapter — no module-level state.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { CachedActiveTicket, TicketStatusView } from '../view-models';

/**
 * Storage key for the read-only active-ticket cache (`store:activeTicket` in the
 * design's persisted-state table). A plain (non-secure) AsyncStorage key.
 */
export const ACTIVE_TICKET_CACHE_KEY = 'store:activeTicket';

/**
 * The minimal async key/value surface the cache depends on. The
 * `@react-native-async-storage/async-storage` default export satisfies this
 * shape; tests provide an in-memory implementation.
 */
export interface AsyncStorageAdapter {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}

/** The public surface returned by {@link createActiveTicketCache}. */
export interface ActiveTicketCache {
  /**
   * Read the cached Active_Ticket, or `null` when nothing is cached. Returns
   * `null` (rather than rejecting) when the stored value is missing, unparseable,
   * or structurally invalid, so callers can treat "no usable cache" uniformly.
   */
  read(): Promise<CachedActiveTicket | null>;
  /**
   * Persist the last-known Active_Ticket details (R9.1). Stamps `cachedAt` with
   * the current time (overridable via `now` for deterministic tests) and returns
   * the record that was written. Rejects only if the adapter rejects.
   */
  write(orgId: string, ticket: TicketStatusView, now?: () => Date): Promise<CachedActiveTicket>;
  /** Remove the cached Active_Ticket. Rejects only if the adapter rejects. */
  clear(): Promise<void>;
}

/** The real `@react-native-async-storage/async-storage` adapter. */
export const asyncStorageAdapter: AsyncStorageAdapter = {
  getItem: (key) => AsyncStorage.getItem(key),
  setItem: (key, value) => AsyncStorage.setItem(key, value),
  removeItem: (key) => AsyncStorage.removeItem(key),
};

/**
 * Narrow an arbitrary parsed value to a {@link CachedActiveTicket}. Guards
 * against corrupt or stale-schema cache entries so a bad record reads back as
 * "no cache" rather than crashing the tracking screen.
 */
function isCachedActiveTicket(value: unknown): value is CachedActiveTicket {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const record = value as Record<string, unknown>;
  return (
    typeof record.orgId === 'string' &&
    typeof record.cachedAt === 'string' &&
    typeof record.ticket === 'object' &&
    record.ticket !== null
  );
}

/**
 * Build an {@link ActiveTicketCache} over the given adapter. Pure with respect
 * to the adapter (no module-level state), so it is fully deterministic in tests.
 *
 * @param adapter The storage backend. Defaults to the AsyncStorage adapter.
 */
export function createActiveTicketCache(
  adapter: AsyncStorageAdapter = asyncStorageAdapter,
): ActiveTicketCache {
  const read: ActiveTicketCache['read'] = async () => {
    let raw: string | null;
    try {
      raw = await adapter.getItem(ACTIVE_TICKET_CACHE_KEY);
    } catch {
      // Storage unavailable on read → treat as no usable cache.
      return null;
    }

    if (raw === null) {
      return null;
    }

    try {
      const parsed: unknown = JSON.parse(raw);
      return isCachedActiveTicket(parsed) ? parsed : null;
    } catch {
      // Corrupt JSON → treat as no usable cache.
      return null;
    }
  };

  const write: ActiveTicketCache['write'] = async (orgId, ticket, now = () => new Date()) => {
    const record: CachedActiveTicket = {
      orgId,
      ticket,
      cachedAt: now().toISOString(),
    };
    await adapter.setItem(ACTIVE_TICKET_CACHE_KEY, JSON.stringify(record));
    return record;
  };

  const clear: ActiveTicketCache['clear'] = () => adapter.removeItem(ACTIVE_TICKET_CACHE_KEY);

  return { read, write, clear };
}

/**
 * The default active-ticket cache bound to `AsyncStorage`. Application code
 * imports this; tests construct their own via {@link createActiveTicketCache}
 * with an in-memory adapter.
 */
export const activeTicketCache: ActiveTicketCache = createActiveTicketCache();
