/*
 * useIdleReset — resets the Kiosk to its start screen after a period of no
 * interaction (R12.7).
 *
 * An always-on kiosk must not leave one customer's half-finished flow on screen
 * for the next person. This hook starts a timer that fires `onIdle` after
 * `timeoutMs`, and restarts that timer on any user interaction (pointer, touch,
 * key, scroll). It is disabled by default and should be enabled only when there
 * is something to reset (i.e. the user has navigated past the start screen) so
 * the start screen itself never needlessly re-renders.
 */
import { useEffect, useRef } from 'react';

import { KIOSK_IDLE_TIMEOUT_MS } from '../lib/constants';

/** Options for {@link useIdleReset}. */
export interface UseIdleResetOptions {
  /** Invoked when the idle timeout elapses with no interaction. */
  onIdle: () => void;
  /** Idle threshold in ms. Defaults to {@link KIOSK_IDLE_TIMEOUT_MS}. */
  timeoutMs?: number;
  /** When false, no timer runs and no listeners are attached. Defaults to true. */
  enabled?: boolean;
}

/** Interaction events that count as activity and restart the idle timer. */
const ACTIVITY_EVENTS: ReadonlyArray<keyof WindowEventMap> = [
  'pointerdown',
  'touchstart',
  'keydown',
  'wheel',
];

/**
 * Run an idle-reset timer for the Kiosk.
 *
 * @param options - the reset callback, timeout, and enablement.
 */
export function useIdleReset({
  onIdle,
  timeoutMs = KIOSK_IDLE_TIMEOUT_MS,
  enabled = true,
}: UseIdleResetOptions): void {
  // Keep the latest callback without re-subscribing listeners every render.
  const onIdleRef = useRef(onIdle);
  onIdleRef.current = onIdle;

  useEffect(() => {
    if (!enabled) {
      return;
    }

    let timer: ReturnType<typeof setTimeout>;

    const restart = (): void => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        onIdleRef.current();
      }, timeoutMs);
    };

    for (const event of ACTIVITY_EVENTS) {
      window.addEventListener(event, restart, { passive: true });
    }
    restart();

    return () => {
      clearTimeout(timer);
      for (const event of ACTIVITY_EVENTS) {
        window.removeEventListener(event, restart);
      }
    };
  }, [enabled, timeoutMs]);
}
