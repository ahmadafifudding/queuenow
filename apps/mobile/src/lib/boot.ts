/*
 * App boot wiring — the small integration layer that connects the low-level
 * `lib/api/client.ts` seams to app-level concerns (navigation + query cache)
 * that the transport layer deliberately does not depend on.
 *
 * Right now its sole responsibility is the return-to-sign-in signal for the
 * R12 refresh-and-retry flow (R12.4). The REST client owns the protocol:
 * a `401` triggers a single-flight `POST /customers/refresh`; on failure
 * (including `404`/`501` while the endpoint is rolling out) it clears the
 * stored tokens, clears the in-memory auth mirror, and invokes the handler
 * registered via `setUnauthorizedHandler`. The client has no business knowing
 * about `expo-router` or TanStack Query, so the actual "route the user back to
 * sign-in and drop their account data" effect is wired here.
 *
 * `installUnauthorizedHandler` is idempotent and safe to call at module load:
 * it only *registers* the callback. The navigation/cache effects run later, at
 * the moment a refresh actually fails — by which point the navigation tree is
 * mounted. Navigation is wrapped defensively so a failed refresh can never
 * crash the app even if it somehow fires before the router is ready.
 */
import { router } from 'expo-router';
import { onlineManager } from '@tanstack/react-query';

import { clearAccountScopedQueries } from '@/lib/api/invalidation';
import { queryClient } from '@/lib/api/query-client';
import { setUnauthorizedHandler } from '@/lib/api/client';
import { authStore } from '@/lib/auth/auth-store';
import { connectivityStore, initConnectivity } from '@/lib/connectivity';
import { registerPushToken, startPushDeepLinking } from '@/lib/notifications/push';
import { initSocketReconnect } from '@/lib/socket';

/** The sign-in route the user is returned to when their session can't be refreshed. */
const SIGN_IN_ROUTE = '/(account)/sign-in';

/** Guard so repeated boot/registration calls don't re-install the same handler. */
let installed = false;

/**
 * Register the return-to-sign-in handler invoked by the REST client after a
 * failed refresh has cleared the session (R12.4).
 *
 * The handler:
 * 1. removes account-scoped query data (history, favorites, notifications) so
 *    no signed-in data survives the invalidated session — the same removal the
 *    explicit sign-out path performs (R7.4); and
 * 2. routes to the sign-in screen with `replace` (not `push`) so the expired
 *    session is not left on the back stack.
 *
 * Note the in-memory auth mirror is already cleared by the client's default
 * `onSessionInvalid` before this handler runs, so it is intentionally not
 * duplicated here.
 *
 * Idempotent: calling it more than once is a no-op after the first install.
 */
export function installUnauthorizedHandler(): void {
  if (installed) {
    return;
  }
  installed = true;

  setUnauthorizedHandler(() => {
    // Drop account-scoped cache so no signed-in data outlives the session (R7.4).
    clearAccountScopedQueries(queryClient);

    // Return to sign-in. Defensive: never let a failed refresh crash the app if
    // navigation isn't ready yet.
    try {
      router.replace(SIGN_IN_ROUTE);
    } catch {
      // Navigation not ready (e.g. refresh failed mid-boot); the cleared session
      // state means the next mounted screen will gate to sign-in regardless.
    }
  });
}

/**
 * Tear down the registered handler. Primarily for tests and hot-reload cleanup;
 * the app itself keeps the handler installed for its whole lifetime.
 */
export function uninstallUnauthorizedHandler(): void {
  setUnauthorizedHandler(null);
  installed = false;
}

/**
 * Start the device-push wiring for R13 and return a single teardown function.
 *
 * This connects the push seams in `lib/notifications/push.ts` to app lifecycle.
 * It is intentionally driven from a mounted-component effect (see the root
 * layout) rather than module load, because:
 *   - the deep-link activation listener navigates via `expo-router`, so it must
 *     run once the navigation tree is mounted; and
 *   - the effect's cleanup gives us a natural place to unsubscribe.
 *
 * Two concerns are wired (both best-effort / non-blocking per R13.4 — nothing
 * here throws or awaits in a way that can block render):
 *
 * 1. **Deep-link on activation (R13.3).** {@link startPushDeepLinking} listens
 *    for a tapped, backend-delivered push and navigates to
 *    `/ticket/[orgId]/[ticketId]` when the payload carries both ids. With the
 *    backend now including `orgId` in the push `data`, delivered pushes resolve
 *    to the active-ticket route; payloads without `orgId` are ignored and the
 *    app simply opens normally.
 *
 * 2. **Push-token registration (R13.1).** {@link registerPushToken} self-gates
 *    on signed-in + OS permission and never throws. We attempt it once on boot
 *    (covers the already-signed-in launch) and again whenever the session
 *    transitions into `'signed-in'` (covers register/login during the session).
 *    Fire-and-forget: a failed/again-skipped registration leaves the
 *    foreground/in-app alert path (task 6.1) as the guaranteed coverage.
 *
 * @returns a teardown that removes the activation listener and the auth
 *   subscription; safe to call from an effect cleanup.
 */
export function startPushWiring(): () => void {
  // 1. Deep-link on push activation (R13.3).
  const stopDeepLinking = startPushDeepLinking();

  // 2. Best-effort token registration on boot (R13.1) — self-gates, never throws.
  void registerPushToken();

  // ...and again whenever the session becomes signed-in (e.g. after login).
  let lastStatus = authStore.getState().status;
  const unsubscribeAuth = authStore.subscribe((state) => {
    if (state.status === 'signed-in' && lastStatus !== 'signed-in') {
      void registerPushToken();
    }
    lastStatus = state.status;
  });

  return () => {
    stopDeepLinking();
    unsubscribeAuth();
  };
}

/**
 * Wire the device connectivity signals that the whole app's offline/restore
 * behavior depends on (R9.2, R9.3, R9.5). This is the single runtime hook-up of
 * the connectivity bridge and the socket reconnect controller — without it the
 * offline UI, live-action gating, and connectivity-restore re-subscription stay
 * dormant on the optimistic defaults. Driven from a mounted-component effect (see
 * the root layout) so the socket reconnect controller and any navigation it can
 * trigger run against a mounted tree; the returned teardown unwires everything.
 *
 * Three concerns are wired:
 *
 * 1. **Connectivity bridge (R9.2/R9.5).** {@link initConnectivity} binds NetInfo +
 *    AppState into the connectivity store so `useConnectivity` /
 *    {@link useLiveActionGate} reflect real device state — that is what flips the
 *    stale indicator and disables live actions with a stated reason while offline.
 *
 * 2. **Socket reconnect triggers (R9.3).** {@link initSocketReconnect} owns the
 *    bounded connect-and-resubscribe cycle and subscribes to the connectivity
 *    store, so a NetInfo "came online" / `AppState` → active transition re-issues
 *    every tracked subscription app-wide (the active-ticket screen separately
 *    refetches its REST data on the same restore).
 *
 * 3. **Query online manager (R9.3).** Bridge the connectivity store into TanStack
 *    Query's {@link onlineManager} so account-scoped queries (history, favorites,
 *    notifications) honor offline state and refetch on connectivity restore,
 *    consistently with the active-ticket refetch — rather than relying on the
 *    web-oriented default online detection that does not observe NetInfo.
 *
 * @returns a teardown that unwires the connectivity bridge, the reconnect
 *   controller, and the online-manager bridge; safe to call from effect cleanup.
 */
export function startConnectivityWiring(): () => void {
  // 1. NetInfo + AppState → connectivity store (offline UI + live-action gating).
  const teardownConnectivity = initConnectivity();

  // 2. Reconnect controller: re-subscribe on connectivity restore / foreground.
  const teardownSocketReconnect = initSocketReconnect();

  // 3. Bridge connectivity into TanStack Query's online manager so all queries
  //    refetch on restore (R9.3). Seed it from the current value, then track it.
  onlineManager.setOnline(connectivityStore.getState().isOnline);
  const unsubscribeOnline = connectivityStore.subscribe((state) => {
    onlineManager.setOnline(state.isOnline);
  });

  return () => {
    unsubscribeOnline();
    teardownSocketReconnect();
    teardownConnectivity();
  };
}
