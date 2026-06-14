/**
 * Push registration + deep-link on activation (R13.1, R13.3, R13.4).
 *
 * This module owns the two device-push concerns that sit alongside the
 * Notification_Manager (task 6.1):
 *
 *   1. **Token registration (R13.1)** — when the customer is signed in AND OS
 *      notification permission is granted, obtain the device's Expo push token
 *      and register it with the backend via `POST /notifications/push-token`,
 *      then mirror the registered token into secure storage
 *      (`SECURE_STORE_KEYS.pushToken`) per the design's persisted-state table.
 *
 *   2. **Deep-link on activation (R13.3)** — when a delivered push for an
 *      Active_Ticket is tapped, navigate to `/ticket/[orgId]/[ticketId]`.
 *
 * **Foreground-only v1 coverage (R13.4).** Backend FCM/APNs delivery is still a
 * TODO, so push delivery is best-effort: NOTHING here throws or blocks the app.
 * If a token cannot be obtained or the backend registration fails, registration
 * resolves with `registered: false` and the in-app / foreground alerts from
 * task 6.1 (Requirement 5) remain the guaranteed turn-alert path. The caller
 * never has to guard with try/catch.
 *
 * **Testability.** The route-mapping logic is a single PURE function,
 * {@link routeForPushPayload}, so the example test (task 6.5) can assert the
 * deep-link mapping with no device. All I/O — `expo-notifications`, the REST
 * client, the router, and secure storage — is injected through small ports
 * ({@link PushDeps}), so the registration flow and the activation listener are
 * verifiable with fakes. Default ports wired to the real modules are exported as
 * {@link registerPushToken} / {@link startPushDeepLinking}.
 *
 * ## orgId-in-payload assumption (R13.3)
 *
 * The active-ticket route is `/ticket/[orgId]/[ticketId]` and therefore needs
 * BOTH ids. The backend's push message today carries only
 * `data: { ticketId, type }` (see `apps/api` `notification.service.ts`
 * `deliverPush`), so `orgId` is NOT yet present. The chosen, forward-compatible
 * resolution is: {@link routeForPushPayload} maps a payload to the route ONLY
 * when BOTH `orgId` and `ticketId` are present, and returns `null` otherwise
 * (no guessing, no partial route, no fake navigation — consistent with R13.4's
 * "degrade, don't fake" stance). When we control the payload (task 18.x), the
 * backend should add `orgId` to the push `data` so this mapping succeeds; until
 * then a tapped push without `orgId` simply does not deep-link and the app opens
 * normally. (If we instead need to deep-link from ticketId alone, the alternative
 * is to look up the ticket's `orgId` via REST before navigating; that is an async
 * concern and intentionally out of this pure mapper.)
 */
import * as Notifications from 'expo-notifications';
import { router } from 'expo-router';
import type { Href } from 'expo-router';

import { apiClient, type ApiClient } from '@/lib/api/client';
import { authStore } from '@/lib/auth/auth-store';
import { SECURE_STORE_KEYS, secureStore, type SecureStoreApi } from '@/lib/auth/secure-store';

/**
 * The concrete active-ticket route shape. A push payload resolves to this exact
 * pattern (`/ticket/[orgId]/[ticketId]`) or to `null`.
 */
export type TicketRoute = `/ticket/${string}/${string}`;

/**
 * PURE. Map a delivered push notification's `data` payload to the target
 * Active_Ticket route, or `null` when it cannot be resolved (R13.3).
 *
 * Treats the payload as untrusted (`expo-notifications` types `data` as
 * `Record<string, unknown>`/`unknown`). Resolves a route ONLY when BOTH a
 * non-empty `orgId` and a non-empty `ticketId` are present — see the
 * "orgId-in-payload assumption" in the module docblock. No side effects, so it
 * is safe for the deep-link example test (task 6.5).
 */
export function routeForPushPayload(data: unknown): TicketRoute | null {
  if (typeof data !== 'object' || data === null) {
    return null;
  }
  const payload = data as Record<string, unknown>;
  const orgId = typeof payload.orgId === 'string' ? payload.orgId.trim() : '';
  const ticketId = typeof payload.ticketId === 'string' ? payload.ticketId.trim() : '';
  if (!orgId || !ticketId) {
    return null;
  }
  return `/ticket/${orgId}/${ticketId}`;
}

// ──────────────────────────────────────────────────────────────────────────
// Injected ports (abstracted so the flow is testable without a device)
// ──────────────────────────────────────────────────────────────────────────

/** Reads OS permission + the device push token (backed by `expo-notifications`). */
export interface PushTokenProvider {
  /** Whether OS notification permission is currently granted (R13.1). */
  isPermissionGranted(): Promise<boolean>;
  /** The device's Expo push token, or `null` when unavailable. May reject. */
  getDevicePushToken(): Promise<string | null>;
}

/** Subscribes to push activations (taps) and yields the notification `data`. */
export interface PushActivationProvider {
  /**
   * Register a handler invoked when the customer activates (taps) a delivered
   * push. Returns an unsubscribe function. Backed by
   * `Notifications.addNotificationResponseReceivedListener`.
   */
  addActivationListener(handler: (data: unknown) => void): () => void;
}

/** Registers a push token with the backend (`POST /notifications/push-token`). */
export interface PushTokenRegistrar {
  register(pushToken: string): Promise<void>;
}

/** Navigates to a resolved route on push activation. */
export interface RouterPort {
  push(route: TicketRoute): void;
}

/** Reports whether a customer session is currently signed in (R13.1). */
export interface SessionProvider {
  isSignedIn(): boolean;
}

/** Everything the push flows need. All injectable for tests. */
export interface PushDeps {
  push: PushTokenProvider;
  activation: PushActivationProvider;
  registrar: PushTokenRegistrar;
  router: RouterPort;
  session: SessionProvider;
  secureStore: SecureStoreApi;
}

/** Why a registration attempt did not register a token (never an error, R13.4). */
export type PushRegistrationSkipReason =
  | 'not-signed-in'
  | 'permission-denied'
  | 'token-unavailable'
  | 'registration-failed';

/** Outcome of {@link registerPushTokenWith}: a registered token or a benign skip. */
export type PushRegistrationResult =
  | { registered: true; token: string }
  | { registered: false; reason: PushRegistrationSkipReason };

/**
 * Register the device push token with the backend, gated on session + permission
 * (R13.1). Never throws and never blocks the app (R13.4): every failure mode
 * resolves to `{ registered: false, reason }` so the foreground/in-app alert path
 * (task 6.1) stays the guaranteed coverage.
 *
 * Flow:
 *  1. Not signed in            → skip (`not-signed-in`).
 *  2. Permission not granted   → skip (`permission-denied`).
 *  3. Token unavailable/throws → skip (`token-unavailable`).
 *  4. Backend registration fails → skip (`registration-failed`).
 *  5. Success                  → mirror the token into secure storage
 *     (`SECURE_STORE_KEYS.pushToken`, best-effort) and return it.
 */
export async function registerPushTokenWith(deps: PushDeps): Promise<PushRegistrationResult> {
  if (!deps.session.isSignedIn()) {
    return { registered: false, reason: 'not-signed-in' };
  }

  const granted = await safe(() => deps.push.isPermissionGranted(), false);
  if (!granted) {
    return { registered: false, reason: 'permission-denied' };
  }

  const token = await safe(() => deps.push.getDevicePushToken(), null);
  if (!token) {
    return { registered: false, reason: 'token-unavailable' };
  }

  const registered = await safe(async () => {
    await deps.registrar.register(token);
    return true;
  }, false);
  if (!registered) {
    return { registered: false, reason: 'registration-failed' };
  }

  // Mirror the registered token into secure storage per the persisted-state
  // table (R13.1). Best-effort: a mirror failure does not fail registration.
  await safe(() => deps.secureStore.write(SECURE_STORE_KEYS.pushToken, token), undefined);

  return { registered: true, token };
}

/**
 * Start listening for push activations and deep-link to the Active_Ticket view
 * on tap (R13.3). Returns an unsubscribe function. A payload that does not
 * resolve via {@link routeForPushPayload} (e.g. missing `orgId`) is ignored — the
 * app opens normally rather than navigating to a guessed route (R13.4).
 */
export function startPushDeepLinkingWith(deps: PushDeps): () => void {
  return deps.activation.addActivationListener((data) => {
    const route = routeForPushPayload(data);
    if (route) {
      deps.router.push(route);
    }
  });
}

/**
 * Run `fn`, returning `fallback` if it throws/rejects. Keeps the push flows
 * total (never throwing) so a device-push problem can never block the app (R13.4).
 */
async function safe<T>(fn: () => Promise<T> | T, fallback: T): Promise<T> {
  try {
    return await fn();
  } catch {
    return fallback;
  }
}

// ──────────────────────────────────────────────────────────────────────────
// Default ports wired to the real modules
// ──────────────────────────────────────────────────────────────────────────

/** Permission + token provider backed by `expo-notifications`. */
const expoPushTokenProvider: PushTokenProvider = {
  async isPermissionGranted() {
    const { granted } = await Notifications.getPermissionsAsync();
    return granted;
  },
  async getDevicePushToken() {
    // No explicit projectId: in EAS/dev builds expo resolves it from the app
    // config; abstracted behind this port so tests never hit the native module.
    const { data } = await Notifications.getExpoPushTokenAsync();
    return data ?? null;
  },
};

/** Activation provider backed by `expo-notifications`' response listener. */
const expoPushActivationProvider: PushActivationProvider = {
  addActivationListener(handler) {
    const subscription = Notifications.addNotificationResponseReceivedListener((response) => {
      handler(response.notification.request.content.data);
    });
    return () => subscription.remove();
  },
};

/** Backend registrar using the REST client (`POST /notifications/push-token`, R13.1). */
function createApiPushTokenRegistrar(client: ApiClient = apiClient): PushTokenRegistrar {
  return {
    async register(pushToken) {
      // `authenticated: true` fails closed without a token, matching the
      // "signed-in" gate; the backend DTO expects `{ pushToken }`.
      await client.post('/notifications/push-token', { pushToken }, { authenticated: true });
    },
  };
}

/** Router port backed by expo-router's imperative `router`. */
const expoRouterPort: RouterPort = {
  push(route) {
    // `route` is the concrete `/ticket/[orgId]/[ticketId]` pattern; cast to the
    // typed-routes `Href` since it is produced from runtime values.
    router.push(route as Href);
  },
};

/** Session provider backed by the in-memory auth store. */
const authStoreSessionProvider: SessionProvider = {
  isSignedIn() {
    return authStore.getState().status === 'signed-in';
  },
};

/** The default dependency set bound to the real modules. */
export const defaultPushDeps: PushDeps = {
  push: expoPushTokenProvider,
  activation: expoPushActivationProvider,
  registrar: createApiPushTokenRegistrar(),
  router: expoRouterPort,
  session: authStoreSessionProvider,
  secureStore,
};

/**
 * Register the device push token using the default (real-module) ports (R13.1).
 * Safe to call opportunistically at boot / after sign-in / after a permission
 * change — it self-gates on session + permission and never throws (R13.4).
 */
export function registerPushToken(): Promise<PushRegistrationResult> {
  return registerPushTokenWith(defaultPushDeps);
}

/**
 * Start push deep-linking using the default (real-module) ports (R13.3). Returns
 * an unsubscribe function; call it on teardown.
 */
export function startPushDeepLinking(): () => void {
  return startPushDeepLinkingWith(defaultPushDeps);
}
