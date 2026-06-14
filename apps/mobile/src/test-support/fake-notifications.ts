/**
 * Notification port fakes (boundary harness — task 2.4).
 *
 * Implement the production Notification_Manager seams from
 * `src/lib/notifications/manager.ts` and `in-app-banner.ts` so the turn-mapping
 * and channel-selection behavior (Properties 10/11) can be exercised without
 * `expo-notifications` or a device. Every port records what it was asked to do
 * so tests can assert the chosen channel produced the right side effect.
 */
import type {
  AppStateProvider,
  AudiblePlayer,
  LocalNotificationPresenter,
  NotificationManagerDeps,
  PermissionProvider,
  TurnAlert,
} from '@/lib/notifications/manager';
import type { InAppBannerEmitter } from '@/lib/notifications/in-app-banner';
import type { NotificationType } from '@queuenow/shared-types';

/** A recorded in-app banner the manager raised. */
export interface RecordedBanner {
  type: NotificationType;
  title: string;
  body: string;
}

/** The set of fake ports plus their recorded interactions. */
export interface FakeNotificationPorts {
  /** Permission provider whose granted-state is controllable. */
  permissions: PermissionProvider & { setGranted(granted: boolean): void };
  /** App-state provider whose foreground-state is controllable. */
  appState: AppStateProvider & { setForeground(foreground: boolean): void };
  /** Records OS local notifications that were presented. */
  localPresenter: LocalNotificationPresenter;
  /** Records audible-alert plays. */
  audible: AudiblePlayer;
  /** Records in-app banners that were shown. */
  banner: InAppBannerEmitter;

  /** OS local notifications presented, in order. */
  readonly presented: TurnAlert[];
  /** Number of times the audible alert was played. */
  readonly playedCount: () => number;
  /** In-app banners shown, in order. */
  readonly banners: RecordedBanner[];

  /** Bundle the ports into the `NotificationManagerDeps` the manager expects. */
  toDeps(): NotificationManagerDeps;
}

/** Knobs for {@link createFakeNotificationPorts}. */
export interface FakeNotificationOptions {
  /** Initial OS permission state (default `true`). */
  permissionGranted?: boolean;
  /** Initial foreground state (default `true`). */
  foreground?: boolean;
}

/** Build the full set of fake notification ports for the manager. */
export function createFakeNotificationPorts(
  options: FakeNotificationOptions = {},
): FakeNotificationPorts {
  let granted = options.permissionGranted ?? true;
  let foreground = options.foreground ?? true;
  const presented: TurnAlert[] = [];
  const banners: RecordedBanner[] = [];
  let played = 0;

  const permissions: FakeNotificationPorts['permissions'] = {
    isGranted: async () => granted,
    setGranted: (value) => {
      granted = value;
    },
  };

  const appState: FakeNotificationPorts['appState'] = {
    isForeground: () => foreground,
    setForeground: (value) => {
      foreground = value;
    },
  };

  const localPresenter: LocalNotificationPresenter = {
    present: async (alert) => {
      presented.push(alert);
    },
  };

  const audible: AudiblePlayer = {
    play: async () => {
      played += 1;
    },
  };

  const banner: InAppBannerEmitter = {
    show: ({ type, title, body }) => {
      banners.push({ type, title, body });
    },
  };

  return {
    permissions,
    appState,
    localPresenter,
    audible,
    banner,
    presented,
    banners,
    playedCount: () => played,
    toDeps: () => ({ permissions, appState, localPresenter, audible, banner }),
  };
}
