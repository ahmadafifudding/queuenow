/**
 * Connectivity bridge (`connectivity.ts`) — NetInfo + AppState (R9.2, R9.3, R9.5).
 *
 * Bridges two device signals into a single small Zustand store the UI can read:
 *
 *  - **Connectivity** (`@react-native-community/netinfo`): whether the device is
 *    online. While offline the tracking screen renders the cached Active_Ticket
 *    with a stale indicator (R9.2) and disables live actions (R9.5); when
 *    connectivity is restored the Realtime_Client/Query layer refetch and
 *    re-subscribe (R9.3, wired by their owning tasks).
 *  - **App activity** (`AppState` from `react-native`): whether the app is
 *    foreground/`active` or `background`. This is exposed so the socket layer can
 *    trigger a reconnect on foreground (R4.4) without re-reading the native API.
 *
 * From these the store derives two convenience signals used across screens:
 *  - `mayBeOutOfDate` — the "data may be out of date" staleness flag shown over
 *    cached data while offline (R9.2).
 *  - `liveActionsDisabled` + `liveActionDisabledReason` — gating for actions that
 *    require a live request; the reason string comes from the centralized i18n
 *    catalog (`offline.actionUnavailable`), never a hardcoded literal (R9.5).
 *
 * Testability: the NetInfo and AppState sources are injected through the
 * {@link NetInfoSource} / {@link AppStateSource} interfaces. The defaults bind
 * the real native modules, but {@link initConnectivity} accepts fakes so the
 * bridge wiring and derivations are verified without a device. The pure helpers
 * {@link deriveOnline} and {@link normalizeAppState} are exported for unit tests.
 */
import { create } from 'zustand';
import NetInfo from '@react-native-community/netinfo';
import { AppState } from 'react-native';
import { strings } from '../i18n';

/** Foreground/background activity state derived from the OS `AppState`. */
export type AppActivityState = 'active' | 'background';

/** The subset of a NetInfo state the bridge reads. */
export interface NetInfoSnapshot {
  /** Whether a network interface is connected; `null` when unknown. */
  isConnected: boolean | null;
  /** Whether the internet is reachable; `null` when not yet determined. */
  isInternetReachable: boolean | null;
}

/**
 * Injectable connectivity source. `@react-native-community/netinfo` satisfies
 * this shape; tests provide a fake that pushes synthetic snapshots.
 */
export interface NetInfoSource {
  /** Read the current connectivity snapshot once. */
  fetch(): Promise<NetInfoSnapshot>;
  /** Subscribe to connectivity changes; returns an unsubscribe function. */
  addEventListener(listener: (state: NetInfoSnapshot) => void): () => void;
}

/**
 * Injectable app-activity source. The `react-native` `AppState` module satisfies
 * this shape; tests provide a fake that pushes synthetic state changes.
 */
export interface AppStateSource {
  /** The current raw OS app state (e.g. `active`, `background`, `inactive`). */
  readonly currentState: string;
  /** Subscribe to app-state changes; returns a removable subscription. */
  addEventListener(listener: (state: string) => void): { remove: () => void };
}

/** Shape of the connectivity store. */
export interface ConnectivityState {
  /** Whether the device currently has usable network connectivity. */
  isOnline: boolean;
  /** Whether the app is foreground/`active` or `background`. */
  appState: AppActivityState;
  /** Staleness flag: cached data may be out of date while offline (R9.2). */
  mayBeOutOfDate: boolean;
  /** Whether actions requiring a live request are disabled (R9.5). */
  liveActionsDisabled: boolean;
  /** Reason shown when a live action is disabled, or `null` when enabled (R9.5). */
  liveActionDisabledReason: string | null;
  /** Apply a new connectivity value and recompute the derived signals. */
  setOnline: (isOnline: boolean) => void;
  /** Apply a new app-activity value. */
  setAppState: (state: AppActivityState) => void;
}

/**
 * Derive whether the device is online from a NetInfo snapshot. Connected counts
 * as online unless the internet is explicitly unreachable; an unknown
 * reachability (`null`) is treated optimistically as online so we don't flag a
 * just-connected device as offline.
 */
export function deriveOnline(snapshot: NetInfoSnapshot): boolean {
  return snapshot.isConnected === true && snapshot.isInternetReachable !== false;
}

/** Normalize a raw OS app-state string to the coarse active/background signal. */
export function normalizeAppState(raw: string): AppActivityState {
  return raw === 'active' ? 'active' : 'background';
}

/** Compute the derived staleness/gating signals for a given connectivity value. */
function deriveGating(
  isOnline: boolean,
): Pick<ConnectivityState, 'mayBeOutOfDate' | 'liveActionsDisabled' | 'liveActionDisabledReason'> {
  return {
    mayBeOutOfDate: !isOnline,
    liveActionsDisabled: !isOnline,
    liveActionDisabledReason: isOnline ? null : strings.offline.actionUnavailable,
  };
}

/**
 * Connectivity store. Starts optimistically online and `active`; the real values
 * are pushed in by {@link initConnectivity} once the native sources report.
 */
export const useConnectivityStore = create<ConnectivityState>((set) => ({
  isOnline: true,
  appState: 'active',
  ...deriveGating(true),

  setOnline: (isOnline) => set({ isOnline, ...deriveGating(isOnline) }),

  setAppState: (state) => set({ appState: state }),
}));

/**
 * Non-hook accessor for the connectivity store, for use outside React (e.g. the
 * REST client / socket layer). Mirrors Zustand's vanilla API surface.
 */
export const connectivityStore = {
  getState: useConnectivityStore.getState,
  setState: useConnectivityStore.setState,
  subscribe: useConnectivityStore.subscribe,
};

/** Default NetInfo source bound to `@react-native-community/netinfo`. */
export const netInfoSource: NetInfoSource = {
  fetch: async () => {
    const state = await NetInfo.fetch();
    return {
      isConnected: state.isConnected,
      isInternetReachable: state.isInternetReachable,
    };
  },
  addEventListener: (listener) =>
    NetInfo.addEventListener((state) =>
      listener({
        isConnected: state.isConnected,
        isInternetReachable: state.isInternetReachable,
      }),
    ),
};

/** Default AppState source bound to the `react-native` `AppState` module. */
export const appStateSource: AppStateSource = {
  get currentState() {
    return AppState.currentState;
  },
  addEventListener: (listener) => AppState.addEventListener('change', listener),
};

/** Options for {@link initConnectivity}; sources default to the native modules. */
export interface InitConnectivityOptions {
  netInfo?: NetInfoSource;
  appState?: AppStateSource;
  store?: Pick<typeof connectivityStore, 'getState'>;
}

/**
 * Wire the native (or injected) sources into the connectivity store and return a
 * teardown function that removes both subscriptions. Seeds the store from the
 * current app-state and an initial NetInfo `fetch()` so the UI reflects reality
 * immediately rather than the optimistic defaults.
 *
 * Intended to be called once at app boot (e.g. from the root layout); tests call
 * it with fakes to drive deterministic state transitions.
 */
export function initConnectivity(options: InitConnectivityOptions = {}): () => void {
  const netInfo = options.netInfo ?? netInfoSource;
  const appState = options.appState ?? appStateSource;
  const { setOnline, setAppState } = useConnectivityStore.getState();

  // Seed app activity from the current OS value.
  setAppState(normalizeAppState(appState.currentState));

  // Seed connectivity from an initial read (best-effort; ignore failures).
  void netInfo
    .fetch()
    .then((snapshot) => setOnline(deriveOnline(snapshot)))
    .catch(() => {
      /* leave the optimistic default in place if the initial read fails */
    });

  const unsubscribeNetInfo = netInfo.addEventListener((snapshot) => {
    setOnline(deriveOnline(snapshot));
  });

  const appStateSubscription = appState.addEventListener((raw) => {
    setAppState(normalizeAppState(raw));
  });

  return () => {
    unsubscribeNetInfo();
    appStateSubscription.remove();
  };
}

/** Convenience hook returning the full connectivity store state. */
export function useConnectivity(): ConnectivityState {
  return useConnectivityStore();
}

/** Result of {@link useLiveActionGate}: whether to disable an action and why. */
export interface LiveActionGate {
  /**
   * Whether the gated action must be disabled — `true` while the device is
   * offline (R9.5) OR while the caller's own `alsoDisabled` condition holds
   * (e.g. a mutation is already in flight).
   */
  disabled: boolean;
  /**
   * The reason to surface when the action is disabled *because the device is
   * offline* (from the i18n catalog, R9.5), or `null` when online. It is
   * intentionally `null` when only `alsoDisabled` is set, so screens don't show
   * an "offline" reason for a pending request.
   */
  reason: string | null;
}

/**
 * Shared gate for any primary action that requires a live network request
 * (R9.5). Every screen that performs a live mutation (join, leave/cancel,
 * favorites add/remove, auth submit) routes its primary action through this hook
 * so the offline disable + stated reason are consistent app-wide rather than
 * re-derived per screen.
 *
 * Reads the gating signals from the connectivity store with field selectors so a
 * gated button only re-renders when the gating actually changes.
 *
 * @param alsoDisabled An additional, caller-owned disable condition (e.g.
 *   `mutation.isPending`). Folded into {@link LiveActionGate.disabled} without
 *   contributing an offline reason.
 * @returns The combined disabled flag and the offline reason (or `null`).
 */
export function useLiveActionGate(alsoDisabled = false): LiveActionGate {
  const liveActionsDisabled = useConnectivityStore((state) => state.liveActionsDisabled);
  const liveActionDisabledReason = useConnectivityStore((state) => state.liveActionDisabledReason);
  return {
    disabled: liveActionsDisabled || alsoDisabled,
    reason: liveActionsDisabled ? liveActionDisabledReason : null,
  };
}
