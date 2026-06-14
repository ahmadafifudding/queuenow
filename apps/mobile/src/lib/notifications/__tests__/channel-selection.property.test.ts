// Feature: customer-mobile-app, Property 11: Notification channel selection.
// For any combination of (permissionGranted, appStateForeground, eventType),
// the selected channel is: OS local notification when permission is granted;
// otherwise, when permission is denied and the app is foreground/active, an
// in-app persistent banner and/or audible alert; otherwise none. The decision
// depends only on permission + foreground state — never on the NotificationType
// — and the absence of a registered push token never suppresses the in-app /
// foreground alert (selectNotificationChannel takes no push-token argument, so
// the channel decision is structurally push-token-independent — R13.4).
//
// Validates: Requirements 5.5, 13.4
//
// `manager.ts` statically imports `expo-notifications` for its default,
// device-wired ports. The pure `selectNotificationChannel` function under test
// needs none of it, so we stub the native module to let the real module load
// under Vitest (same pattern as the turn-mapping property test, task 6.3). The
// in-app banner module only pulls in `zustand` (pure), so it needs no stub.
import { NotificationType } from '@queuenow/shared-types';
import fc from 'fast-check';
import { describe, expect, it, vi } from 'vitest';

vi.mock('expo-notifications', () => ({
  getPermissionsAsync: vi.fn(async () => ({ granted: true })),
  scheduleNotificationAsync: vi.fn(async () => undefined),
}));

import { type NotificationChannel, selectNotificationChannel } from '@/lib/notifications/manager';

/** Minimum fast-check iterations per property (design requires ≥100). */
const NUM_RUNS = 100;

// --- arbitraries -------------------------------------------------------------

/** Every member of the shared `NotificationType` enum, uniformly. */
const notificationTypeArb: fc.Arbitrary<NotificationType> = fc.constantFrom(
  NotificationType.ALMOST_TURN,
  NotificationType.YOUR_TURN,
  NotificationType.SKIPPED,
);

/** All NotificationType members as a stable list (for the independence check). */
const allTypes: readonly NotificationType[] = [
  NotificationType.ALMOST_TURN,
  NotificationType.YOUR_TURN,
  NotificationType.SKIPPED,
];

// --- oracle ------------------------------------------------------------------

/**
 * Independent oracle for the expected channel, derived straight from the R5.5 /
 * R13.4 decision table — deliberately NOT calling the production function:
 *
 *   granted               → 'os-local-notification'
 *   denied + foreground   → 'in-app'
 *   denied + background   → 'none'
 */
function expectedChannel(
  permissionGranted: boolean,
  appStateForeground: boolean,
): NotificationChannel {
  if (permissionGranted) {
    return 'os-local-notification';
  }
  return appStateForeground ? 'in-app' : 'none';
}

// --- properties --------------------------------------------------------------

describe('Property 11: Notification channel selection', () => {
  it('selects the channel by permission + foreground state for every input combination (R5.5, R13.4)', () => {
    fc.assert(
      fc.property(
        fc.boolean(),
        fc.boolean(),
        notificationTypeArb,
        (permissionGranted, appStateForeground, eventType) => {
          const channel = selectNotificationChannel(
            permissionGranted,
            appStateForeground,
            eventType,
          );

          // Matches the independent decision-table oracle.
          expect(channel).toBe(expectedChannel(permissionGranted, appStateForeground));

          // Spelled-out invariants from the requirement:
          // - OS local notification iff permission is granted.
          expect(channel === 'os-local-notification').toBe(permissionGranted);
          // - in-app iff denied AND foreground/active.
          expect(channel === 'in-app').toBe(!permissionGranted && appStateForeground);
          // - none iff denied AND not foreground.
          expect(channel === 'none').toBe(!permissionGranted && !appStateForeground);
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  it('is independent of eventType: same (permission, foreground) yields the same channel across all NotificationTypes', () => {
    fc.assert(
      fc.property(fc.boolean(), fc.boolean(), (permissionGranted, appStateForeground) => {
        // Compute the channel for every NotificationType with the same
        // permission/foreground inputs; they must all be identical — the turn
        // type never influences the channel decision.
        const channels = allTypes.map((type) =>
          selectNotificationChannel(permissionGranted, appStateForeground, type),
        );

        const first = channels[0];
        expect(channels.every((c) => c === first)).toBe(true);
        expect(first).toBe(expectedChannel(permissionGranted, appStateForeground));
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('guarantees the foreground in-app alert whenever permission is denied and the app is active, regardless of push token (R13.4)', () => {
    fc.assert(
      fc.property(notificationTypeArb, (eventType) => {
        // Permission denied + foreground/active is the guaranteed-coverage path.
        // `selectNotificationChannel` takes NO push-token argument, so there is
        // no input by which a missing push token could suppress this alert: the
        // channel is structurally push-token-independent. For every turn type,
        // the denied + foreground case always resolves to the in-app banner.
        expect(selectNotificationChannel(false, true, eventType)).toBe('in-app');
      }),
      { numRuns: NUM_RUNS },
    );
  });
});
