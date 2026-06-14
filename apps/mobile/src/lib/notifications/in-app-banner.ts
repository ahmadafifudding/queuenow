/**
 * In-app turn-alert banner store (R5.5).
 *
 * When OS local-notification permission is DENIED and the app is in the
 * foreground, turn alerts cannot be delivered through the OS. The
 * Notification_Manager instead surfaces them in-app via a **persistent banner**
 * (and/or an audible alert). This module is that banner mechanism: a tiny
 * Zustand store the UI can subscribe to and render at the app root.
 *
 * "Persistent" means the banner stays visible until the customer dismisses it
 * (or it is replaced by a newer alert) — it is NOT auto-timed away — so a turn
 * alert is never missed while the app is foregrounded with notifications off.
 *
 * The store holds ONLY ephemeral UI state and is created with plain `create`
 * (no persistence middleware): nothing here is written to device storage.
 */
import { create } from 'zustand';
import type { NotificationType } from '@queuenow/shared-types';

/** A single in-app banner derived from a turn-alert event. */
export interface InAppBanner {
  /** Unique id so the UI can key/animate replacements. */
  id: string;
  /** The originating notification type (drives icon/severity in the UI). */
  type: NotificationType;
  /** Short headline (from the i18n catalog). */
  title: string;
  /** Supporting line (from the i18n catalog). */
  body: string;
  /** Epoch ms the banner was raised (for ordering / display). */
  createdAt: number;
}

/** Shape of the in-app banner store. */
export interface InAppBannerState {
  /** The currently displayed banner, or `null` when none is showing. */
  banner: InAppBanner | null;
  /**
   * Raise a banner. The most recent alert replaces any prior one so the
   * customer always sees the latest turn state (e.g. ALMOST_TURN → YOUR_TURN).
   */
  show: (banner: InAppBanner) => void;
  /** Dismiss the current banner (user action). */
  dismiss: () => void;
}

/** Counter used to mint stable, monotonic banner ids without extra deps. */
let bannerSeq = 0;

/**
 * In-app banner store. Plain `create` (no `persist`) — purely ephemeral UI.
 */
export const useInAppBannerStore = create<InAppBannerState>((set) => ({
  banner: null,
  show: (banner) => set({ banner }),
  dismiss: () => set({ banner: null }),
}));

/**
 * The minimal surface the Notification_Manager needs to raise a banner.
 * Abstracting it (rather than calling the store directly) keeps the manager
 * pure-ish and trivially testable: tests inject a fake emitter and assert what
 * was shown without mounting a React tree.
 */
export interface InAppBannerEmitter {
  show: (input: { type: NotificationType; title: string; body: string }) => void;
}

/**
 * Default emitter backed by the Zustand store. Mints an id + timestamp and
 * pushes the banner into the store for the root UI to render.
 */
export const inAppBannerEmitter: InAppBannerEmitter = {
  show: ({ type, title, body }) => {
    bannerSeq += 1;
    useInAppBannerStore.getState().show({
      id: `banner-${bannerSeq}`,
      type,
      title,
      body,
      createdAt: Date.now(),
    });
  },
};

/** Non-hook accessor for use outside React (manager, tests). */
export const inAppBannerStore = {
  getState: useInAppBannerStore.getState,
  setState: useInAppBannerStore.setState,
  subscribe: useInAppBannerStore.subscribe,
};
