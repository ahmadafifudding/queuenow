/**
 * Notification_Manager (R5).
 *
 * Maps `ticket:notification` events for the Active_Ticket to turn alerts and
 * decides how to surface each alert based on OS notification permission and the
 * app's foreground/active state. Two responsibilities are deliberately split
 * into **pure, exported functions** so they can be property-tested without a
 * device (tasks 6.3 / 6.4):
 *
 *   - {@link turnAlertForEvent}      — `NotificationType` → `{ title, body }`
 *   - {@link selectNotificationChannel} — `(granted, foreground, type)` → channel
 *
 * The impure parts (reading permission, presenting an OS notification, playing a
 * sound, raising the in-app banner) are injected via {@link NotificationManagerDeps}
 * so tests substitute fakes. A default manager wired to `expo-notifications`
 * (+ the in-app banner store) is exported as {@link notificationManager}, and
 * {@link onTicketNotification} is the seam the Realtime_Client (task 3.1) calls
 * with each `ticket:notification` payload.
 *
 * Alerts are produced ONLY in response to an event (R5.4): every alert flows
 * through {@link NotificationManager.handleTicketNotification}; nothing here
 * schedules or polls proactively.
 *
 * Scope (task 6.1): event→alert mapping + channel selection + in-app banner
 * mechanism. Push-token registration and deep-linking are task 6.2.
 */
import * as Notifications from 'expo-notifications';
import { NotificationType } from '@queuenow/shared-types';
import { strings } from '../../i18n';
import { type InAppBannerEmitter, inAppBannerEmitter } from './in-app-banner';

/**
 * Normalized turn-notification event handed to the manager. The raw socket
 * payload is untrusted/loosely typed (the backend gateway emits `payload: any`);
 * {@link toTicketNotificationEvent} narrows it to this shape before mapping.
 */
export interface TicketNotificationEvent {
  /** Turn type from `@queuenow/shared-types` `NotificationType` (R5.6). */
  type: NotificationType;
  /** The ticket the event targets (used by the Realtime_Client to scope it). */
  ticketId?: string;
  /** Counter name, present for `YOUR_TURN` so the alert can name it (R5.2). */
  counterName?: string | null;
}

/** A resolved turn alert: copy pulled from the i18n catalog (`notifications.*`). */
export interface TurnAlert {
  /** The originating notification type. */
  type: NotificationType;
  /** Short headline. */
  title: string;
  /** Supporting line (counter name interpolated for `YOUR_TURN`). */
  body: string;
}

/**
 * Where a turn alert is surfaced:
 *  - `os-local-notification` — OS local notification via expo-notifications.
 *  - `in-app`                — persistent in-app banner + audible alert.
 *  - `none`                  — cannot surface (denied + not foreground); the
 *                              guaranteed coverage is foreground/in-app (R13.4).
 */
export type NotificationChannel = 'os-local-notification' | 'in-app' | 'none';

/**
 * PURE. Map a turn event to its alert copy from the i18n catalog (R5.1/5.2/5.3/5.6).
 *
 * Exhaustive over every `NotificationType`; adding a new enum member is a
 * compile error here (the `never` default), so mapping can never silently drop
 * a turn type.
 *
 * `YOUR_TURN` identifies the counter when one is present (R5.2), falling back to
 * generic copy otherwise. No side effects — safe for property testing (6.3).
 */
export function turnAlertForEvent(event: TicketNotificationEvent): TurnAlert {
  const copy = strings.notifications;

  switch (event.type) {
    case NotificationType.ALMOST_TURN:
      return {
        type: event.type,
        title: copy.almostTurnTitle,
        body: copy.almostTurnBody,
      };
    case NotificationType.YOUR_TURN: {
      const counter = event.counterName?.trim();
      return {
        type: event.type,
        title: copy.yourTurnTitle,
        body: counter
          ? copy.yourTurnBody.replace('{counter}', counter)
          : copy.yourTurnBodyNoCounter,
      };
    }
    case NotificationType.SKIPPED:
      return {
        type: event.type,
        title: copy.skippedTitle,
        body: copy.skippedBody,
      };
    default: {
      // Exhaustiveness guard: a new NotificationType must be handled above.
      const exhaustive: never = event.type;
      throw new Error(`Unhandled notification type: ${String(exhaustive)}`);
    }
  }
}

/**
 * PURE. Choose the delivery channel for a turn alert (R5.5, R13.4).
 *
 *  - permission GRANTED                  → `os-local-notification`
 *  - permission DENIED + foreground/active → `in-app` (banner + audible)
 *  - permission DENIED + not foreground    → `none`
 *
 * `eventType` is part of the signature (every turn type is alertable the same
 * way) and is accepted for completeness/traceability with Property 11; the
 * decision itself depends only on permission and foreground state. No side
 * effects — safe for property testing (6.4).
 */
export function selectNotificationChannel(
  permissionGranted: boolean,
  appStateForeground: boolean,
  _eventType: NotificationType,
): NotificationChannel {
  if (permissionGranted) {
    return 'os-local-notification';
  }
  // Permission denied: only the foreground in-app path can reach the customer.
  return appStateForeground ? 'in-app' : 'none';
}

/**
 * Best-effort narrowing of a raw socket `ticket:notification` payload into a
 * {@link TicketNotificationEvent}. Returns `null` when the payload does not
 * carry a recognized `NotificationType`, so the manager never acts on garbage.
 * Treats all socket input as untrusted.
 */
export function toTicketNotificationEvent(payload: unknown): TicketNotificationEvent | null {
  if (typeof payload !== 'object' || payload === null) {
    return null;
  }
  const raw = payload as Record<string, unknown>;
  const type = raw.type;
  const isKnownType =
    typeof type === 'string' && (Object.values(NotificationType) as string[]).includes(type);
  if (!isKnownType) {
    return null;
  }

  const ticketId = typeof raw.ticketId === 'string' ? raw.ticketId : undefined;
  const counterName =
    typeof raw.counterName === 'string'
      ? raw.counterName
      : typeof raw.counter === 'string'
        ? raw.counter
        : null;

  return { type: type as NotificationType, ticketId, counterName };
}

// ──────────────────────────────────────────────────────────────────────────
// Injected side-effect ports (abstracted so tests don't need a device)
// ──────────────────────────────────────────────────────────────────────────

/** Reads current OS local-notification permission (R5.5). */
export interface PermissionProvider {
  isGranted(): Promise<boolean>;
}

/** Reports whether the app is currently foreground/active (R5.5). */
export interface AppStateProvider {
  isForeground(): boolean;
}

/** Presents an OS local notification (the granted-permission path). */
export interface LocalNotificationPresenter {
  present(alert: TurnAlert): Promise<void>;
}

/** Plays an audible alert (the denied + foreground fallback, R5.5). */
export interface AudiblePlayer {
  play(): Promise<void>;
}

/** Everything the manager needs to surface an alert. All injectable for tests. */
export interface NotificationManagerDeps {
  permissions: PermissionProvider;
  appState: AppStateProvider;
  localPresenter: LocalNotificationPresenter;
  audible: AudiblePlayer;
  banner: InAppBannerEmitter;
}

/** Public manager surface consumed by the Realtime_Client bridge (task 3.1). */
export interface NotificationManager {
  /**
   * Handle one turn event end-to-end: map → choose channel → surface. Returns
   * the channel used (handy for tests/telemetry). Alerts are produced ONLY here,
   * in response to an event (R5.4).
   */
  handleTicketNotification(event: TicketNotificationEvent): Promise<NotificationChannel>;
}

/**
 * Build a Notification_Manager from injected ports. Pure mapping + channel
 * selection drive the behavior; only the chosen channel performs a side effect.
 */
export function createNotificationManager(deps: NotificationManagerDeps): NotificationManager {
  return {
    async handleTicketNotification(event) {
      const alert = turnAlertForEvent(event); // R5.1/5.2/5.3/5.6
      const granted = await deps.permissions.isGranted();
      const foreground = deps.appState.isForeground();
      const channel = selectNotificationChannel(granted, foreground, event.type); // R5.5

      switch (channel) {
        case 'os-local-notification':
          await deps.localPresenter.present(alert);
          break;
        case 'in-app':
          // Persistent banner + audible alert (R5.5). Both fire; the banner is
          // the durable signal, the sound is the attention-grabber.
          deps.banner.show({ type: alert.type, title: alert.title, body: alert.body });
          await deps.audible.play();
          break;
        case 'none':
          // Denied + backgrounded: no guaranteed in-app surface. Background
          // coverage depends on push delivery (R13), out of scope for 6.1.
          break;
        default: {
          const exhaustive: never = channel;
          throw new Error(`Unhandled channel: ${String(exhaustive)}`);
        }
      }

      return channel;
    },
  };
}

// ──────────────────────────────────────────────────────────────────────────
// Default ports wired to expo-notifications (no extra deps)
// ──────────────────────────────────────────────────────────────────────────

/** Permission port backed by `expo-notifications`. */
const expoPermissionProvider: PermissionProvider = {
  async isGranted() {
    const { granted } = await Notifications.getPermissionsAsync();
    return granted;
  },
};

/**
 * Foreground/active port. `expo-notifications` presents notifications regardless
 * of app state, so the default reports `false` (treat as background) and the
 * real foreground signal is provided by the connectivity/AppState bridge
 * (task 5.2) when the manager is wired at app boot. Kept abstract so the pure
 * channel logic stays the single source of truth.
 */
const defaultAppStateProvider: AppStateProvider = {
  isForeground() {
    return false;
  },
};

/** OS local-notification presenter backed by `expo-notifications`. */
const expoLocalNotificationPresenter: LocalNotificationPresenter = {
  async present(alert) {
    await Notifications.scheduleNotificationAsync({
      content: { title: alert.title, body: alert.body, sound: 'default' },
      // `null` trigger = present immediately (R5.4: only in response to event).
      trigger: null,
    });
  },
};

/**
 * Audible-alert port. Uses `expo-notifications` so we avoid an extra `expo-av`
 * dependency: it presents a minimal sound-only notification to produce the
 * attention chime when permission is denied but the app is foregrounded. Kept
 * behind the {@link AudiblePlayer} port so it can be swapped for `expo-av` (or
 * silenced) without touching the manager.
 */
const expoAudiblePlayer: AudiblePlayer = {
  async play() {
    await Notifications.scheduleNotificationAsync({
      content: { sound: 'default' },
      trigger: null,
    });
  },
};

/**
 * Default manager wired to expo-notifications + the in-app banner store. Use in
 * the app; tests should call {@link createNotificationManager} with fakes.
 */
export const notificationManager: NotificationManager = createNotificationManager({
  permissions: expoPermissionProvider,
  appState: defaultAppStateProvider,
  localPresenter: expoLocalNotificationPresenter,
  audible: expoAudiblePlayer,
  banner: inAppBannerEmitter,
});

/**
 * Seam for the Realtime_Client (task 3.1).
 *
 * `src/lib/socket.ts` does not exist yet. When the socket bridge lands, its
 * `ticket:notification` handler should call this with the raw payload; until
 * then this is the single entry point for delivering turn events to the default
 * manager. The payload is normalized (and rejected if it lacks a known
 * `NotificationType`) so the bridge can forward the gateway's `payload: any`
 * verbatim. Returns the channel used, or `null` if the payload was ignored.
 *
 * Wiring assumption: the socket bridge filters events to the Active_Ticket and
 * passes through the gateway payload; it may set `appState.isForeground` via the
 * AppState bridge (task 5.2) by constructing its own manager with
 * {@link createNotificationManager} if it needs live foreground state.
 */
export async function onTicketNotification(payload: unknown): Promise<NotificationChannel | null> {
  const event = toTicketNotificationEvent(payload);
  if (!event) {
    return null;
  }
  return notificationManager.handleTicketNotification(event);
}
