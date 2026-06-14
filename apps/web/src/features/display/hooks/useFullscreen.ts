/*
 * useFullscreen — thin wrapper over the Fullscreen API for the unattended
 * Display board (R7.8).
 *
 * The board is meant to run on a TV with no interaction after setup, so it
 * offers a single fullscreen toggle that takes the WHOLE page fullscreen
 * (`document.documentElement`). The hook tracks the live fullscreen state via
 * the `fullscreenchange` event so the toggle label stays correct even when the
 * user exits with the Esc key, and reports whether the API is supported so the
 * control can hide itself where it is unavailable.
 *
 * Entering fullscreen requires a user gesture; `enter`/`toggle` are therefore
 * called from a click handler. All calls are guarded so they never throw on
 * unsupported hosts (e.g. jsdom in tests) — they simply no-op.
 */
import { useCallback, useEffect, useState } from 'react';

/** The fullscreen controls and live state returned by {@link useFullscreen}. */
export interface UseFullscreenResult {
  /** Whether the document is currently presented fullscreen. */
  isFullscreen: boolean;
  /** Whether the host supports the Fullscreen API at all. */
  isSupported: boolean;
  /** Request fullscreen for the whole page (must be called from a user gesture). */
  enter: () => Promise<void>;
  /** Exit fullscreen if currently active. */
  exit: () => Promise<void>;
  /** Toggle fullscreen on/off. */
  toggle: () => Promise<void>;
}

/** Whether the Fullscreen API is available in the current environment. */
function detectSupport(): boolean {
  return (
    typeof document !== 'undefined' &&
    typeof document.documentElement.requestFullscreen === 'function'
  );
}

/**
 * Track and control whole-page fullscreen presentation for the Display board.
 */
export function useFullscreen(): UseFullscreenResult {
  const [isSupported] = useState<boolean>(detectSupport);
  const [isFullscreen, setIsFullscreen] = useState<boolean>(
    () => typeof document !== 'undefined' && document.fullscreenElement !== null,
  );

  useEffect(() => {
    if (!isSupported) {
      return;
    }
    const onChange = (): void => {
      setIsFullscreen(document.fullscreenElement !== null);
    };
    document.addEventListener('fullscreenchange', onChange);
    return () => {
      document.removeEventListener('fullscreenchange', onChange);
    };
  }, [isSupported]);

  const enter = useCallback(async (): Promise<void> => {
    if (!isSupported || document.fullscreenElement !== null) {
      return;
    }
    try {
      await document.documentElement.requestFullscreen();
    } catch {
      // Ignore: the gesture may have been rejected or the API unavailable.
    }
  }, [isSupported]);

  const exit = useCallback(async (): Promise<void> => {
    if (!isSupported || document.fullscreenElement === null) {
      return;
    }
    try {
      await document.exitFullscreen();
    } catch {
      // Ignore: nothing to exit, or the API rejected the call.
    }
  }, [isSupported]);

  const toggle = useCallback(async (): Promise<void> => {
    if (document.fullscreenElement === null) {
      await enter();
    } else {
      await exit();
    }
  }, [enter, exit]);

  return { isFullscreen, isSupported, enter, exit, toggle };
}
