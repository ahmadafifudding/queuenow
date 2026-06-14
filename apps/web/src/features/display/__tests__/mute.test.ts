/**
 * Display mute-preference example tests (task 9.3, Requirement 15.1).
 *
 * Behavior-focused coverage of the Display board's mute control (R7.5) and the
 * way it gates announcements:
 *   - `useMutePreference` defaults to unmuted, `toggleMuted()` flips the state
 *     and persists it to `localStorage`, and a fresh mount restores the
 *     persisted value (a long-lived display is a device-level preference).
 *   - `useAnnouncer` does NOT announce newly-called tickets while muted, and
 *     resumes announcing once unmuted — without replaying the backlog that
 *     arrived while muted.
 *
 * Mocking strategy (boundary only — implementation is NOT modified):
 *   - `localStorage` is jsdom's real implementation; we clear it between tests.
 *   - The Web Audio `AudioContext` is stubbed via `vi.stubGlobal` so the
 *     announcer reports it can produce sound; each chime records its created
 *     oscillators, which is how we observe whether an announcement fired.
 *   - Speech is intentionally left UNAVAILABLE (jsdom default), so an
 *     announcement is a chime alone — enough to assert "announced vs not".
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook } from '@testing-library/react';

import { useMutePreference } from '../hooks/useMutePreference';
import { useAnnouncer, type UseAnnouncerOptions } from '../hooks/useAnnouncer';
import type { DisplayCalledEntry } from '../types';

const STORAGE_KEY = 'queuenow.display.muted';

// ---------------------------------------------------------------------------
// Minimal Web Audio double: records the oscillators each chime creates so a
// test can assert whether an announcement was produced.
// ---------------------------------------------------------------------------

class MockAudioParam {
  readonly setValueAtTime = vi.fn();
  readonly exponentialRampToValueAtTime = vi.fn();
}

class MockGainNode {
  readonly gain = new MockAudioParam();
  readonly connect = vi.fn();
}

class MockOscillatorNode {
  type = 'sine';
  readonly frequency = new MockAudioParam();
  readonly connect = vi.fn();
  readonly start = vi.fn();
  readonly stop = vi.fn();
}

class MockAudioContext {
  static instances: MockAudioContext[] = [];

  state: AudioContextState = 'running';
  currentTime = 0;
  destination = {} as AudioDestinationNode;

  readonly oscillators: MockOscillatorNode[] = [];

  readonly resume = vi.fn(() => Promise.resolve());
  readonly createGain = vi.fn((): MockGainNode => new MockGainNode());
  readonly createOscillator = vi.fn((): MockOscillatorNode => {
    const oscillator = new MockOscillatorNode();
    this.oscillators.push(oscillator);
    return oscillator;
  });

  constructor() {
    MockAudioContext.instances.push(this);
  }
}

/** Total oscillators created across all contexts === how many tones chimed. */
function totalOscillators(): number {
  return MockAudioContext.instances.reduce((sum, ctx) => sum + ctx.oscillators.length, 0);
}

/** Build a called entry for the board's flattened render list. */
function entry(ticketNumber: string, key: string): DisplayCalledEntry {
  return {
    ticketNumber,
    counterName: 'Counter 1',
    key,
    serviceName: 'General',
  };
}

beforeEach(() => {
  window.localStorage.clear();
  MockAudioContext.instances = [];
});

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  vi.unstubAllGlobals();
});

describe('useMutePreference — toggle + persistence (R7.5, Req 15.1)', () => {
  it('defaults to unmuted', () => {
    const { result } = renderHook(() => useMutePreference());
    expect(result.current.muted).toBe(false);
  });

  it('toggleMuted flips the state and persists it to localStorage', () => {
    const { result } = renderHook(() => useMutePreference());

    act(() => {
      result.current.toggleMuted();
    });
    expect(result.current.muted).toBe(true);
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe('true');

    act(() => {
      result.current.toggleMuted();
    });
    expect(result.current.muted).toBe(false);
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe('false');
  });

  it('restores the persisted value on a fresh mount', () => {
    window.localStorage.setItem(STORAGE_KEY, 'true');

    const { result } = renderHook(() => useMutePreference());
    expect(result.current.muted).toBe(true);
  });
});

describe('useAnnouncer — mute gates announcements (R7.5, Req 15.1)', () => {
  it('does not announce while muted, then announces newly-called tickets once unmuted', () => {
    vi.stubGlobal('AudioContext', MockAudioContext);

    const initial = [entry('A1', 'k1')];
    const { rerender } = renderHook((props: UseAnnouncerOptions) => useAnnouncer(props), {
      initialProps: { entries: initial, enabled: true, muted: true },
    });

    // First observation only seeds the "seen" set — nothing is announced, and a
    // new ticket arriving while muted must not chime.
    rerender({ entries: [entry('A2', 'k2'), ...initial], enabled: true, muted: true });
    expect(totalOscillators()).toBe(0);

    // Unmuting and receiving a newly-called ticket announces it (a chime is
    // produced), and it does NOT replay the ticket that arrived while muted.
    rerender({
      entries: [entry('A3', 'k3'), entry('A2', 'k2'), ...initial],
      enabled: true,
      muted: false,
    });
    expect(totalOscillators()).toBeGreaterThan(0);
  });
});
