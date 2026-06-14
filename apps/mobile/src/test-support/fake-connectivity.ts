/**
 * Connectivity fakes (boundary harness — task 2.4).
 *
 * Implement the production {@link NetInfoSource} / {@link AppStateSource} seams
 * from `src/lib/connectivity.ts` so the offline-cache / staleness / live-action
 * gating behavior (Property 18) and the socket reconnect triggers (Properties
 * 8/9) can be driven deterministically — no device, no real `NetInfo`/`AppState`.
 *
 * Each fake records its current value and exposes a driver to push synthetic
 * changes to subscribed listeners.
 */
import type { AppStateSource, NetInfoSnapshot, NetInfoSource } from '@/lib/connectivity';

/** A controllable {@link NetInfoSource}. */
export interface FakeNetInfo {
  /** The source to inject into `initConnectivity({ netInfo })`. */
  source: NetInfoSource;
  /** Push a new connectivity snapshot to listeners (and update `fetch()`'s result). */
  emit(snapshot: NetInfoSnapshot): void;
  /** Convenience: emit a fully online/offline snapshot. */
  setOnline(online: boolean): void;
  /** The most recent snapshot `fetch()` will resolve. */
  readonly current: NetInfoSnapshot;
}

const ONLINE_SNAPSHOT: NetInfoSnapshot = { isConnected: true, isInternetReachable: true };
const OFFLINE_SNAPSHOT: NetInfoSnapshot = { isConnected: false, isInternetReachable: false };

/** Build a controllable NetInfo source seeded with `initial` (default online). */
export function createFakeNetInfoSource(initial: NetInfoSnapshot = ONLINE_SNAPSHOT): FakeNetInfo {
  let snapshot: NetInfoSnapshot = initial;
  const listeners = new Set<(state: NetInfoSnapshot) => void>();

  const source: NetInfoSource = {
    fetch: async () => snapshot,
    addEventListener: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };

  return {
    source,
    get current() {
      return snapshot;
    },
    emit(next) {
      snapshot = next;
      for (const listener of listeners) {
        listener(next);
      }
    },
    setOnline(online) {
      this.emit(online ? ONLINE_SNAPSHOT : OFFLINE_SNAPSHOT);
    },
  };
}

/** A controllable {@link AppStateSource}. */
export interface FakeAppState {
  /** The source to inject into `initConnectivity({ appState })`. */
  source: AppStateSource;
  /** Push a new raw OS app-state string to listeners (and update `currentState`). */
  emit(state: string): void;
}

/** Build a controllable AppState source seeded with `initial` (default `active`). */
export function createFakeAppStateSource(initial = 'active'): FakeAppState {
  let currentState = initial;
  const listeners = new Set<(state: string) => void>();

  const source: AppStateSource = {
    get currentState() {
      return currentState;
    },
    addEventListener: (listener) => {
      listeners.add(listener);
      return {
        remove: () => {
          listeners.delete(listener);
        },
      };
    },
  };

  return {
    source,
    emit(state) {
      currentState = state;
      for (const listener of listeners) {
        listener(state);
      }
    },
  };
}
