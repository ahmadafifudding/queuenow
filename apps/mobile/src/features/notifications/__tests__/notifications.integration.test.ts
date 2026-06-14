// Feature: customer-mobile-app, Task 14.2 integration test
//
// Validates: Requirements 5.7, 13.1
//
// Integration test for the two notification network contracts the design
// "Endpoint map" specifies:
//   - the persisted-notifications query     → GET  /notifications        (R5.7)
//   - push-token registration (when gated)  → POST /notifications/push-token (R13.1)
//
// APPROACH (mirrors the favorites / history integration tests, tasks 13.2/12.4):
//   This app's suite runs in a headless `node` environment with NO React
//   renderer / testing-library (see vitest.config.ts), so rendering the
//   `useNotifications` TanStack Query hook to invoke its `queryFn` is
//   impractical. As task 14.2 allows, we drive the SAME REST transport the hook
//   and the push registrar use — the `createApiClient` factory that backs the
//   singleton `apiClient` — over an injected fake `fetch`, and assert the
//   METHOD, PATH, Authorization header, and unwrapped body for each.
//
//   * Notifications: `useNotifications`'s queryFn does exactly
//     `apiClient.get('/notifications', { authenticated: true })` and returns the
//     ordered `data.notifications`. We replicate that request and assert it is a
//     Bearer-auth GET /notifications whose `{ notifications, total, limit, offset }`
//     body is unwrapped from the success envelope.
//   * Push registration: we drive the REAL `registerPushTokenWith(deps)` flow
//     through its injectable `PushDeps` ports (session / permission / token
//     provider / registrar). The registrar is the production one — a thin
//     `client.post('/notifications/push-token', { pushToken }, { authenticated: true })`
//     over the same `createApiClient` + fake `fetch` — so we assert the POST is
//     actually issued (with the token + Bearer header) ONLY when signed-in AND
//     permission granted, and that signed-out / permission-denied skip the
//     network entirely and return the benign `{ registered: false, reason }`
//     without throwing (R13.4).
//   No live backend, device keychain, or React runtime is touched.

// `@/lib/notifications/push` statically imports device-wired modules for its
// default ports (`expo-notifications`, `expo-router`) and transitively pulls in
// the REST client → `expo-secure-store` (secure-store) and `expo-constants`
// (env). The injected `PushDeps` need none of them, so we stub the native
// boundary to let the REAL modules under test load under Vitest (same pattern as
// the push-deeplink / favorites / history tests). Nothing about the behavior is
// faked — only the unparseable native packages are stubbed.
import { describe, expect, it, vi } from 'vitest';

vi.mock('expo-notifications', () => ({
  getPermissionsAsync: vi.fn(async () => ({ granted: true })),
  getExpoPushTokenAsync: vi.fn(async () => ({ data: 'ExponentPushToken[stub]' })),
  addNotificationResponseReceivedListener: vi.fn(() => ({ remove: vi.fn() })),
}));
vi.mock('expo-router', () => ({ router: { push: vi.fn() } }));
vi.mock('expo-secure-store', () => ({
  getItemAsync: vi.fn(async () => null),
  setItemAsync: vi.fn(async () => undefined),
  deleteItemAsync: vi.fn(async () => undefined),
}));
vi.mock('expo-constants', () => ({ default: { expoConfig: { extra: {} } } }));

import { NotificationType } from '@queuenow/shared-types';

import { type ApiClient, createApiClient } from '@/lib/api/client';
import { createSecureStore } from '@/lib/auth/secure-store';
import { registerPushTokenWith, type PushDeps } from '@/lib/notifications/push';
import type { NotificationsListResponse } from '@/features/notifications/types';
import {
  createFakeFetch,
  createInMemorySecureStore,
  createMockTokenStore,
  successResponse,
  type FakeFetch,
} from '@/test-support';

const BASE_URL = 'https://api.test.local/api/v1';
const ACCESS_TOKEN = 'access-token-abc123';
const PUSH_TOKEN = 'ExponentPushToken[xyz-123]';

// Paths replicated verbatim from the production sources (kept private there, so
// we reproduce the exact contract the hook / registrar depend on).
const NOTIFICATIONS_PATH = '/notifications';
const PUSH_TOKEN_PATH = '/notifications/push-token';

/** Narrow a possibly-undefined value to defined, failing the test otherwise. */
function expectDefined<T>(value: T | null | undefined, label: string): T {
  if (value === null || value === undefined) {
    throw new Error(`expected ${label} to be defined`);
  }
  return value;
}

/** A representative `GET /notifications` paginated body (R5.7). */
const NOTIFICATIONS_BODY: NotificationsListResponse = {
  notifications: [
    {
      id: 'ntf_2',
      type: NotificationType.YOUR_TURN,
      status: 'DELIVERED',
      createdAt: '2024-01-02T09:05:00.000Z',
      ticket: {
        id: 'tkt_2',
        ticketNumber: 'GP002',
        orgId: 'org_1',
        service: { id: 'svc_gp', name: 'General Practice' },
      },
    },
    {
      id: 'ntf_1',
      type: NotificationType.ALMOST_TURN,
      status: 'DELIVERED',
      createdAt: '2024-01-01T09:00:00.000Z',
      ticket: {
        id: 'tkt_1',
        ticketNumber: 'LB001',
        orgId: 'org_1',
        service: { id: 'svc_lab', name: 'Lab Tests' },
      },
    },
  ],
  total: 2,
  limit: 20,
  offset: 0,
};

/**
 * The production push-token registrar (`createApiPushTokenRegistrar`, kept
 * private in `push.ts`): a thin `POST /notifications/push-token` over the REST
 * client with `authenticated: true`. Reproduced here so the registration flow
 * issues the exact request the app makes.
 */
function apiRegistrar(client: ApiClient): PushDeps['registrar'] {
  return {
    async register(pushToken: string): Promise<void> {
      await client.post(PUSH_TOKEN_PATH, { pushToken }, { authenticated: true });
    },
  };
}

/** Build a `PushDeps` set whose registrar is wired to the given REST client. */
function buildPushDeps(
  client: ApiClient,
  overrides: {
    signedIn?: boolean;
    permissionGranted?: boolean;
    devicePushToken?: string | null;
  } = {},
): PushDeps {
  const { signedIn = true, permissionGranted = true, devicePushToken = PUSH_TOKEN } = overrides;
  return {
    push: {
      isPermissionGranted: async (): Promise<boolean> => permissionGranted,
      getDevicePushToken: async (): Promise<string | null> => devicePushToken,
    },
    activation: { addActivationListener: (): (() => void) => () => undefined },
    registrar: apiRegistrar(client),
    router: { push: (): void => undefined },
    session: { isSignedIn: (): boolean => signedIn },
    // A real SecureStoreApi backed by an in-memory adapter (no device keychain).
    secureStore: createSecureStore(createInMemorySecureStore()),
  };
}

describe('Task 14.2: notifications list + push-token registration network contracts', () => {
  describe('notifications list query (R5.7)', () => {
    it('issues an authenticated GET /notifications and unwraps the paginated body', async () => {
      // This is exactly the request `useNotifications`'s queryFn makes:
      //   apiClient.get<NotificationsListResponse>('/notifications', { authenticated: true }).
      const fakeFetch = createFakeFetch(() => successResponse(NOTIFICATIONS_BODY));
      const client = createApiClient({
        fetchFn: fakeFetch.fetch,
        tokenStore: createMockTokenStore({ accessToken: ACCESS_TOKEN }),
        baseUrl: BASE_URL,
      });

      const { data } = await client.get<NotificationsListResponse>(NOTIFICATIONS_PATH, {
        authenticated: true,
      });

      // Exactly one request, with the right method + path (Bearer-auth list read).
      expect(fakeFetch.calls).toHaveLength(1);
      const sent = expectDefined(fakeFetch.calls[0], 'recorded fetch call');
      expect(sent.method).toBe('GET');
      expect(sent.url).toBe(`${BASE_URL}/notifications`);
      expect(sent.headers.get('Authorization')).toBe(`Bearer ${ACCESS_TOKEN}`);

      // The success envelope is unwrapped to the `{ notifications, total, limit, offset }` body.
      expect(data).toEqual(NOTIFICATIONS_BODY);
      expect(data.notifications.map((n) => n.id)).toEqual(['ntf_2', 'ntf_1']);
      expect(data.total).toBe(2);
      expect(data.limit).toBe(20);
      expect(data.offset).toBe(0);
    });

    it('fails closed (no request sent) when the authenticated list call has no token (R5.7)', async () => {
      // The notifications query is `authenticated`, so the client must throw and
      // NOT hit the network when no token is available — the account-scoped list
      // is never requested without a session (the screen shows an account prompt).
      const fakeFetch = createFakeFetch(() => successResponse(NOTIFICATIONS_BODY));
      const client = createApiClient({
        fetchFn: fakeFetch.fetch,
        tokenStore: createMockTokenStore({ accessToken: null }),
        baseUrl: BASE_URL,
      });

      await expect(
        client.get<NotificationsListResponse>(NOTIFICATIONS_PATH, { authenticated: true }),
      ).rejects.toMatchObject({ code: 'AUTH_UNAUTHORIZED' });
      expect(fakeFetch.calls).toHaveLength(0);
    });
  });

  describe('push-token registration (R13.1)', () => {
    /** A client + fake fetch that records the push-token registration POST. */
    function registrarClient(): { client: ApiClient; fakeFetch: FakeFetch } {
      const fakeFetch = createFakeFetch(() => successResponse({ registered: true }));
      const client = createApiClient({
        fetchFn: fakeFetch.fetch,
        tokenStore: createMockTokenStore({ accessToken: ACCESS_TOKEN }),
        baseUrl: BASE_URL,
      });
      return { client, fakeFetch };
    }

    it('POSTs /notifications/push-token with the token when signed-in and permission granted', async () => {
      const { client, fakeFetch } = registrarClient();
      const deps = buildPushDeps(client, { signedIn: true, permissionGranted: true });

      const result = await registerPushTokenWith(deps);

      // Registration succeeded and returned the registered token.
      expect(result).toEqual({ registered: true, token: PUSH_TOKEN });

      // Exactly one authenticated POST to the push-token endpoint, carrying the
      // device token in the body and the Bearer header (R13.1).
      expect(fakeFetch.calls).toHaveLength(1);
      const sent = expectDefined(fakeFetch.calls[0], 'recorded fetch call');
      expect(sent.method).toBe('POST');
      expect(sent.url).toBe(`${BASE_URL}/notifications/push-token`);
      expect(sent.headers.get('Authorization')).toBe(`Bearer ${ACCESS_TOKEN}`);
      expect(JSON.parse(expectDefined(sent.body, 'request body'))).toEqual({
        pushToken: PUSH_TOKEN,
      });

      // The registered token is mirrored into secure storage (R13.1 persisted state).
      expect(await deps.secureStore.read('pushToken')).toBe(PUSH_TOKEN);
    });

    it('does NOT register (no network) when signed-out, returning a benign skip (R13.4)', async () => {
      const { client, fakeFetch } = registrarClient();
      const deps = buildPushDeps(client, { signedIn: false, permissionGranted: true });

      const result = await registerPushTokenWith(deps);

      // Benign skip, no throw, and the push-token endpoint is never called.
      expect(result).toEqual({ registered: false, reason: 'not-signed-in' });
      expect(fakeFetch.calls).toHaveLength(0);
      expect(await deps.secureStore.read('pushToken')).toBeNull();
    });

    it('does NOT register (no network) when permission is denied, returning a benign skip (R13.4)', async () => {
      const { client, fakeFetch } = registrarClient();
      const deps = buildPushDeps(client, { signedIn: true, permissionGranted: false });

      const result = await registerPushTokenWith(deps);

      // Benign skip, no throw, and the push-token endpoint is never called.
      expect(result).toEqual({ registered: false, reason: 'permission-denied' });
      expect(fakeFetch.calls).toHaveLength(0);
      expect(await deps.secureStore.read('pushToken')).toBeNull();
    });
  });
});
