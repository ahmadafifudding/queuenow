/*
 * useMutePreference — the Display board's mute toggle state (R7.5).
 *
 * A display is typically a long-lived, unattended screen, so the mute choice is
 * persisted to `localStorage` (a device preference) and restored on reload. The
 * store access is guarded so it degrades to in-memory state where storage is
 * unavailable (private mode, jsdom, etc.). Default is unmuted.
 */
import { useCallback, useState } from 'react';

/** Storage key for the persisted mute preference. */
const STORAGE_KEY = 'queuenow.display.muted';

/** Read the persisted preference, defaulting to unmuted. */
function readInitial(): boolean {
  if (typeof window === 'undefined') {
    return false;
  }
  try {
    return window.localStorage.getItem(STORAGE_KEY) === 'true';
  } catch {
    return false;
  }
}

/** Persist the preference, ignoring storage failures. */
function persist(value: boolean): void {
  if (typeof window === 'undefined') {
    return;
  }
  try {
    window.localStorage.setItem(STORAGE_KEY, value ? 'true' : 'false');
  } catch {
    // Ignore: storage may be unavailable; the in-memory state still applies.
  }
}

/** The mute state and controls returned by {@link useMutePreference}. */
export interface UseMutePreferenceResult {
  /** Whether announcements are currently muted. */
  muted: boolean;
  /** Flip the mute state. */
  toggleMuted: () => void;
  /** Set the mute state explicitly. */
  setMuted: (value: boolean) => void;
}

/** Track and persist the Display board's mute preference. */
export function useMutePreference(): UseMutePreferenceResult {
  const [muted, setMutedState] = useState<boolean>(readInitial);

  const setMuted = useCallback((value: boolean): void => {
    setMutedState(value);
    persist(value);
  }, []);

  const toggleMuted = useCallback((): void => {
    setMutedState((previous) => {
      const next = !previous;
      persist(next);
      return next;
    });
  }, []);

  return { muted, toggleMuted, setMuted };
}
