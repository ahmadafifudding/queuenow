/**
 * Manual Jest mock for the ESM-only `expo-server-sdk` package.
 *
 * `expo-server-sdk@6` ships as native ESM (`import ... from 'node:assert'`),
 * which Jest's CommonJS runtime cannot parse when the module is loaded
 * transitively (e.g. `queue.service.ts` -> `notification.service.ts` ->
 * `expo-server-sdk`). Placing this manual mock in the root `__mocks__`
 * directory makes Jest substitute it automatically for any suite that loads
 * the package, so tests that mock `NotificationService` entirely never touch
 * the real ESM module.
 *
 * Suites that need to exercise real Expo delivery behavior (e.g.
 * `notification.service.spec.ts`) provide their own `jest.mock('expo-server-sdk', factory)`
 * which takes precedence over this manual mock.
 */

export class Expo {
  static isExpoPushToken(_token: unknown): boolean {
    return true;
  }

  sendPushNotificationsAsync(_messages: unknown[]): Promise<unknown[]> {
    return Promise.resolve([]);
  }
}

export type ExpoPushMessage = Record<string, unknown>;
export type ExpoPushTicket = Record<string, unknown>;
