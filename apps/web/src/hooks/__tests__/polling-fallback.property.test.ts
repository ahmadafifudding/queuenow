// Feature: web-app, Property 12: Polling fallback is active only while disconnected beyond the threshold

import fc from 'fast-check';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook } from '@testing-library/react';

import { queryClient } from '@/lib/api/query-client';
import { queryKeys } from '@/lib/api/query-keys';
import { type SocketStatus, useSocketStatus } from '@/lib/socket';
import {
  DISCONNECT_THRESHOLD_MS,
  POLL_INTERVAL_MS,
  usePollingFallback,
} from '@/hooks/usePollingFallback';

/**
 * Property 12 — Polling fallback is active only while disconnected beyond the threshold.
 * Validates: Requirements 3.8, 3.9, 7.9
 *
 *  - R3.8: while the socket is disconnected beyond 15s, poll queue status every 10s.
 *  - R3.9: when the socket reconnects, stop the polling fallback.
 *  - R7.9: the always-on Display relies on this fallback to keep updating during outages.
 *
 * `usePollingFallback` implements "polling" as `queryClient.invalidateQueries` on
 * the queue key, so the observable signal is the count of invalidation calls and
 * the key they target. The test therefore:
 *   - drives connection status through the `useSocketStatus` Zustand store,
 *   - runs the clock with Vitest FAKE TIMERS, and
 *   - spies on the shared `queryClient.invalidateQueries`.
 *
 * Oracle: an INDEPENDENT pure function `expectedTicks(elapsedDisconnectedMs)`
 * computes how many poll ticks must have fired for a given continuous-outage
 * duration, derived only from the EXPORTED constants (never hardcoded magic
 * numbers). The property compares the spy's call count against this oracle at
 * every phase of a generated timeline.
 *
 * The generated timeline models a continuous outage as a sequence of segments,
 * each holding either `disconnected` or `reconnecting`. Both map to the hook's
 * single derived `disconnected` boolean, so flipping between them must NOT
 * restart the 15s threshold — the oracle measures the *cumulative* outage and so
 * pins that behavior. After the outage the timeline either reconnects (polling
 * must stop) or stays down (polling must continue).
 */

const RUNS = 150;

/** A status that counts as "disconnected" for the fallback. */
type DisconnectedStatus = Extract<SocketStatus, 'disconnected' | 'reconnecting'>;

/**
 * Independent oracle: number of poll invalidations that must have fired after a
 * *continuous* outage of `elapsedMs`. Polling only begins once the outage passes
 * the threshold, and then fires once per interval. Derived purely from the
 * exported constants so the test never restates 15000/10000.
 */
function expectedTicks(elapsedMs: number): number {
  if (elapsedMs < DISCONNECT_THRESHOLD_MS) {
    return 0;
  }
  return Math.floor((elapsedMs - DISCONNECT_THRESHOLD_MS) / POLL_INTERVAL_MS);
}

/** One held segment of a continuous outage: a disconnected status for `durationMs`. */
interface OutageSegment {
  status: DisconnectedStatus;
  durationMs: number;
}

interface Timeline {
  /** The continuous-outage segments (cumulative duration measures the outage). */
  segments: OutageSegment[];
  /** Whether the socket reconnects after the outage segments. */
  reconnect: boolean;
  /** Extra time advanced after reconnect (or while still down, if no reconnect). */
  tailMs: number;
}

const segmentArb: fc.Arbitrary<OutageSegment> = fc.record({
  status: fc.constantFrom<DisconnectedStatus>('disconnected', 'reconnecting'),
  // 1ms..40s so a single segment can sit either side of the 15s threshold.
  durationMs: fc.integer({ min: 1, max: 40_000 }),
});

const timelineArb: fc.Arbitrary<Timeline> = fc.record({
  segments: fc.array(segmentArb, { minLength: 1, maxLength: 6 }),
  reconnect: fc.boolean(),
  tailMs: fc.integer({ min: 0, max: 60_000 }),
});

/** Set the live connection status from outside React (mirrors the Socket_Client). */
function setStatus(status: SocketStatus): void {
  useSocketStatus.setState({ status });
}

/** Assert every recorded invalidation targeted the expected queue query key. */
function assertAllCallsTargetQueueKey(
  calls: readonly (readonly unknown[])[],
  orgId: string,
  serviceId: string | undefined,
): void {
  const expectedKey = queryKeys.queue(orgId, serviceId);
  for (const call of calls) {
    expect(call[0]).toEqual({ queryKey: expectedKey });
  }
}

describe('Property 12: polling fallback is active only while disconnected beyond the threshold', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    useSocketStatus.setState({ status: 'idle' });
  });

  it('invalidates exactly once per interval only past the threshold, and stops on reconnect', () => {
    fc.assert(
      fc.property(
        timelineArb,
        fc.string({ minLength: 1 }),
        fc.option(fc.string({ minLength: 1 }), { nil: undefined }),
        (timeline, orgId, serviceId) => {
          // Fresh, healthy starting point before mounting the hook.
          setStatus('connected');
          const spy = vi.spyOn(queryClient, 'invalidateQueries').mockResolvedValue(undefined);

          const { unmount } = renderHook(() => usePollingFallback({ orgId, serviceId }));

          // Healthy connection ⇒ no polling, regardless of time passing.
          act(() => {
            vi.advanceTimersByTime(POLL_INTERVAL_MS * 2);
          });
          expect(spy).toHaveBeenCalledTimes(0);

          // Drive the continuous outage segment by segment. The derived
          // `disconnected` boolean stays true across disconnected⇄reconnecting
          // flips, so the threshold is measured from the first segment only.
          let elapsed = 0;
          for (const segment of timeline.segments) {
            act(() => {
              setStatus(segment.status);
            });
            act(() => {
              vi.advanceTimersByTime(segment.durationMs);
            });
            elapsed += segment.durationMs;
            expect(spy).toHaveBeenCalledTimes(expectedTicks(elapsed));
          }

          if (timeline.reconnect) {
            // R3.9: reconnect tears down the timers ⇒ polling stops.
            act(() => {
              setStatus('connected');
            });
            const afterReconnect = spy.mock.calls.length;
            act(() => {
              vi.advanceTimersByTime(timeline.tailMs + POLL_INTERVAL_MS * 2);
            });
            expect(spy).toHaveBeenCalledTimes(afterReconnect);
          } else {
            // Still down: polling keeps firing on the same cadence.
            act(() => {
              vi.advanceTimersByTime(timeline.tailMs);
            });
            elapsed += timeline.tailMs;
            expect(spy).toHaveBeenCalledTimes(expectedTicks(elapsed));
          }

          // Every invalidation must have targeted the queue key for this room.
          assertAllCallsTargetQueueKey(spy.mock.calls, orgId, serviceId);

          // Cleanup on unmount: no further polling after the hook is gone.
          unmount();
          const afterUnmount = spy.mock.calls.length;
          act(() => {
            vi.advanceTimersByTime(POLL_INTERVAL_MS * 3);
          });
          expect(spy).toHaveBeenCalledTimes(afterUnmount);

          spy.mockRestore();
        },
      ),
      { numRuns: RUNS },
    );
  });

  it('does not poll when reconnected before the threshold elapses', () => {
    setStatus('connected');
    const spy = vi.spyOn(queryClient, 'invalidateQueries').mockResolvedValue(undefined);
    const { unmount } = renderHook(() => usePollingFallback({ orgId: 'org-1' }));

    act(() => {
      setStatus('disconnected');
    });
    // Sit just under the threshold, then recover.
    act(() => {
      vi.advanceTimersByTime(DISCONNECT_THRESHOLD_MS - 1);
    });
    act(() => {
      setStatus('connected');
    });
    act(() => {
      vi.advanceTimersByTime(POLL_INTERVAL_MS * 5);
    });

    expect(spy).toHaveBeenCalledTimes(0);
    unmount();
    spy.mockRestore();
  });

  it('fires once per interval after the threshold while continuously disconnected', () => {
    setStatus('connected');
    const spy = vi.spyOn(queryClient, 'invalidateQueries').mockResolvedValue(undefined);
    const { unmount } = renderHook(() =>
      usePollingFallback({ orgId: 'org-1', serviceId: 'svc-9' }),
    );

    act(() => {
      setStatus('disconnected');
    });
    // threshold + 3 full intervals ⇒ exactly 3 invalidations.
    act(() => {
      vi.advanceTimersByTime(DISCONNECT_THRESHOLD_MS + POLL_INTERVAL_MS * 3);
    });

    expect(spy).toHaveBeenCalledTimes(3);
    expect(spy).toHaveBeenLastCalledWith({ queryKey: queryKeys.queue('org-1', 'svc-9') });
    unmount();
    spy.mockRestore();
  });

  it('never polls while disabled, even when disconnected beyond the threshold', () => {
    setStatus('disconnected');
    const spy = vi.spyOn(queryClient, 'invalidateQueries').mockResolvedValue(undefined);
    const { unmount } = renderHook(() => usePollingFallback({ orgId: 'org-1', enabled: false }));

    act(() => {
      vi.advanceTimersByTime(DISCONNECT_THRESHOLD_MS + POLL_INTERVAL_MS * 4);
    });

    expect(spy).toHaveBeenCalledTimes(0);
    unmount();
    spy.mockRestore();
  });
});
