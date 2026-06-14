/*
 * Kiosk-wide constants.
 */

/**
 * Idle timeout, in milliseconds, after which the Kiosk resets to the
 * service-selection start screen so the next customer gets a clean state
 * (R12.7). Exported so tests (task 16.3, fake timers) can reference the exact
 * value rather than hard-coding it.
 */
export const KIOSK_IDLE_TIMEOUT_MS = 45_000;
