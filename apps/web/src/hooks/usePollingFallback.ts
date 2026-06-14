/*
 * usePollingFallback — REST polling fallback for queue data while realtime is
 * down (R3.8, R3.9, R7.9).
 *
 * The Socket_Client (`lib/socket.ts`) is the single source of liveness and
 * exposes its connection status via the `useSocketStatus` Zustand store. This
 * hook watches that status and, when the connection has been down for more than
 * `DISCONNECT_THRESHOLD_MS`, begins invalidating the relevant queue query key
 * every `POLL_INTERVAL_MS`. Because "polling" is implemented as query
 * invalidation, it reuses the exact same REST path and cache as a normal load —
 * there is no separate degraded code path (design "Polling fallback").
 *
 * Timing notes (kept deterministic for the fake-timer property test, task 3.4):
 * - The threshold and interval are exported named constants so tests can
 *   reference them rather than hardcoding magic numbers.
 * - Polling is keyed on a single derived boolean (`disconnected`) rather than
 *   the raw status, so transient flips between `disconnected` and
 *   `reconnecting` while the socket retries do NOT restart the 15s threshold.
 *   The threshold therefore measures the *continuous* outage duration.
 * - When the socket reconnects (status returns to `connected`), the effect
 *   tears down both timers immediately, so polling stops on reconnect (R3.9).
 * - All timers are cleared on unmount via the effect cleanup.
 */
import { useEffect } from 'react';

import { queryClient } from '@/lib/api/query-client';
import { queryKeys } from '@/lib/api/query-keys';
import { type SocketStatus, useSocketStatus } from '@/lib/socket';

/**
 * How long the socket must stay disconnected before the REST polling fallback
 * kicks in (R3.8: "disconnected beyond 15 seconds").
 */
export const DISCONNECT_THRESHOLD_MS = 15_000;

/** How often the fallback invalidates the queue query key while active (R3.8). */
export const POLL_INTERVAL_MS = 10_000;

/** Options controlling the polling fallback for a single queue room. */
export interface UsePollingFallbackOptions {
  /** The organization whose queue query key should be refreshed while polling. */
  orgId: string;
  /** Optional service to scope polling to a single service's queue query key. */
  serviceId?: string;
  /**
   * When `false`, the hook never polls (e.g. while `orgId` is not yet known).
   * Defaults to `true`.
   */
  enabled?: boolean;
}

/**
 * A status counts as "disconnected" while the socket has dropped and is either
 * idle-after-drop (`disconnected`) or actively retrying (`reconnecting`).
 * `idle`/`connecting` are pre-connection states and `connected` is healthy —
 * none of those should trigger the fallback.
 */
function isDisconnected(status: SocketStatus): boolean {
  return status === 'disconnected' || status === 'reconnecting';
}

/**
 * Poll queue status over REST while the realtime connection is down beyond the
 * threshold, and stop as soon as it is restored.
 *
 * @param options - the queue room to refresh plus enablement.
 */
export function usePollingFallback(options: UsePollingFallbackOptions): void {
  const { orgId, serviceId, enabled = true } = options;
  const disconnected = useSocketStatus((state) => isDisconnected(state.status));

  useEffect(() => {
    if (!enabled || !orgId || !disconnected) {
      return;
    }

    let intervalId: ReturnType<typeof setInterval> | undefined;

    // Wait out the threshold before treating the outage as "degraded"; only
    // then start the recurring REST poll (query invalidation).
    const thresholdId = setTimeout(() => {
      intervalId = setInterval(() => {
        void queryClient.invalidateQueries({
          queryKey: queryKeys.queue(orgId, serviceId),
        });
      }, POLL_INTERVAL_MS);
    }, DISCONNECT_THRESHOLD_MS);

    return () => {
      clearTimeout(thresholdId);
      if (intervalId !== undefined) {
        clearInterval(intervalId);
      }
    };
  }, [disconnected, orgId, serviceId, enabled]);
}
