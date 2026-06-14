/*
 * useAnnouncer — drive the Display board's audio announcements (R7.4).
 *
 * The board has no bespoke socket handling: the socket bridge invalidates the
 * public queue query on `queue:ticket-called`, the query re-fetches, and the
 * flattened "currently called" list this hook receives changes. To announce
 * each NEWLY-called ticket we therefore diff the called set between renders:
 * any entry whose stable key was not present on the previous render is new and
 * is announced (chime → spoken number + counter, chime-only when speech is
 * unavailable).
 *
 * The "seen" set is seeded from whatever is already on the board the first time
 * we observe it, so loading the board does not announce the entire current
 * board. The seen set is advanced on every change even while muted or before
 * sound is unlocked, so unmuting later never replays a backlog — only tickets
 * called from that point forward are announced.
 *
 * All audio is delegated to the guarded {@link createAnnouncer} util, so this
 * hook is safe to run under jsdom / hosts without the audio APIs.
 */
import { useCallback, useEffect, useRef, type RefObject } from 'react';

import { strings } from '@/i18n';

import { createAnnouncer, type Announcer } from '../lib/audio';
import type { DisplayCalledEntry } from '../types';

/** Options controlling the announcer. */
export interface UseAnnouncerOptions {
  /** The currently-called entries rendered on the board (newest first). */
  entries: readonly DisplayCalledEntry[];
  /** Whether audio has been unlocked by the one-time gesture (R7.6). */
  enabled: boolean;
  /** Whether announcements are muted by the mute control (R7.5). */
  muted: boolean;
}

/** What the hook exposes back to the board. */
export interface UseAnnouncerResult {
  /** Unlock audio from a user gesture (wired to the sound-unlock overlay). */
  unlock: () => void;
  /** Whether the host can produce any announcement (chime or speech) at all. */
  canAnnounce: boolean;
}

/** Build the spoken announcement string for a called entry (R7.4). */
function buildAnnouncement(entry: DisplayCalledEntry): string {
  const template = entry.counterName
    ? strings.display.announce.withCounter
    : strings.display.announce.withoutCounter;
  return template
    .replace('{number}', entry.ticketNumber)
    .replace('{counter}', entry.counterName ?? '');
}

/** Lazily obtain the per-board announcer instance held in `ref`. */
function getAnnouncer(ref: RefObject<Announcer | null>): Announcer {
  if (ref.current === null) {
    ref.current = createAnnouncer();
  }
  return ref.current;
}

/**
 * Announce newly-called tickets as the board updates.
 *
 * @param options - the called entries plus the unlock/mute state.
 */
export function useAnnouncer(options: UseAnnouncerOptions): UseAnnouncerResult {
  const { entries, enabled, muted } = options;

  const announcerRef = useRef<Announcer | null>(null);
  // Create once during render (lazy ref pattern) so `canAnnounce` is available
  // immediately; construction is pure and touches no browser APIs.
  const announcer = getAnnouncer(announcerRef);

  // Keys seen on the previous render. `null` until the board is first observed.
  const seenKeysRef = useRef<Set<string> | null>(null);

  useEffect(() => {
    const currentKeys = new Set(entries.map((entry) => entry.key));
    const previous = seenKeysRef.current;

    // First observation: seed the seen set without announcing the existing
    // board (those tickets were called before this screen was watching).
    if (previous === null) {
      seenKeysRef.current = currentKeys;
      return;
    }

    if (enabled && !muted) {
      for (const entry of entries) {
        if (!previous.has(entry.key)) {
          announcer.announce(buildAnnouncement(entry));
        }
      }
    }

    // Advance the seen set regardless of mute/enable so we never replay a
    // backlog once announcements resume.
    seenKeysRef.current = currentKeys;
  }, [entries, enabled, muted, announcer]);

  // Stop any in-progress speech on unmount.
  useEffect(() => {
    return () => {
      announcer.cancel();
    };
  }, [announcer]);

  const unlock = useCallback(() => {
    announcer.unlock();
  }, [announcer]);

  return { unlock, canAnnounce: announcer.canAnnounce };
}
