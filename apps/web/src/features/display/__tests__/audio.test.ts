/**
 * Display audio announcer example tests (task 9.3, Requirement 15.1).
 *
 * Behavior-focused coverage of the guarded `createAnnouncer` util that powers
 * the public Display board's spoken/chimed announcements (R7.4):
 *   1. Chime + TTS — with a mocked Web Audio `AudioContext` and a mocked Web
 *      Speech API, `announce(text)` plays the two-tone chime immediately and
 *      then (after the chime lead) speaks `text` via `speechSynthesis.speak`.
 *   2. Chime-only fallback — with speech UNAVAILABLE but audio present,
 *      `announce(text)` still chimes, never throws, and makes no speak call.
 *
 * Mocking strategy (boundary only — the implementation is NOT modified):
 *   - jsdom ships neither `AudioContext` nor `speechSynthesis`, so we install
 *     light hand-rolled doubles via `vi.stubGlobal`. The mock `AudioContext`
 *     records each created oscillator/gain and spies `resume`, so we can assert
 *     the chime actually started its oscillators. The mock speech engine spies
 *     `speak` and captures the utterance text.
 *   - `vi.useFakeTimers()` lets us advance the chime→speak lead deterministically
 *     (the util waits ~520ms after the chime before speaking).
 *   - Globals/timers are reset between tests so capability detection (captured
 *     at `createAnnouncer()` time) is clean per case.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createAnnouncer, isSpeechSupported, isAudioSupported } from '../lib/audio';

// ---------------------------------------------------------------------------
// Web Audio API doubles. They record what the chime created so a test can
// assert oscillators were started, and spy `resume` (called when the context
// starts suspended, as a freshly-created context does).
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
  /** Every context constructed during a test, so assertions can find it. */
  static instances: MockAudioContext[] = [];

  state: AudioContextState = 'suspended';
  currentTime = 0;
  destination = {} as AudioDestinationNode;

  readonly oscillators: MockOscillatorNode[] = [];
  readonly gains: MockGainNode[] = [];

  readonly resume = vi.fn(() => Promise.resolve());

  readonly createGain = vi.fn((): MockGainNode => {
    const gain = new MockGainNode();
    this.gains.push(gain);
    return gain;
  });

  readonly createOscillator = vi.fn((): MockOscillatorNode => {
    const oscillator = new MockOscillatorNode();
    this.oscillators.push(oscillator);
    return oscillator;
  });

  constructor() {
    MockAudioContext.instances.push(this);
  }
}

// ---------------------------------------------------------------------------
// Web Speech API doubles.
// ---------------------------------------------------------------------------

class MockSpeechSynthesisUtterance {
  text: string;
  rate = 1;
  pitch = 1;
  volume = 1;

  constructor(text: string) {
    this.text = text;
  }
}

interface MockSpeechSynthesis {
  speak: ReturnType<typeof vi.fn>;
  cancel: ReturnType<typeof vi.fn>;
  resume: ReturnType<typeof vi.fn>;
}

function installSpeechMock(): MockSpeechSynthesis {
  const speech: MockSpeechSynthesis = {
    speak: vi.fn(),
    cancel: vi.fn(),
    resume: vi.fn(),
  };
  vi.stubGlobal('speechSynthesis', speech);
  vi.stubGlobal('SpeechSynthesisUtterance', MockSpeechSynthesisUtterance);
  return speech;
}

/** The lead (ms) the util waits after the chime before speaking. */
const CHIME_LEAD_MS = 520;

beforeEach(() => {
  vi.useFakeTimers();
  MockAudioContext.instances = [];
});

afterEach(() => {
  vi.runOnlyPendingTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('createAnnouncer — chime + TTS (R7.4, Req 15.1)', () => {
  it('plays the chime immediately and speaks the text after the chime lead', () => {
    vi.stubGlobal('AudioContext', MockAudioContext);
    const speech = installSpeechMock();

    const announcer = createAnnouncer();
    expect(announcer.isAudioSupported).toBe(true);
    expect(announcer.isSpeechSupported).toBe(true);
    expect(announcer.canAnnounce).toBe(true);

    announcer.announce('Now calling number A012');

    // The chime is played synchronously: a gain node + two oscillators that
    // start, and the suspended context is resumed.
    const ctx = MockAudioContext.instances[0];
    expect(ctx).toBeDefined();
    expect(ctx?.resume).toHaveBeenCalled();
    expect(ctx?.createGain).toHaveBeenCalledTimes(1);
    expect(ctx?.createOscillator).toHaveBeenCalledTimes(2);
    expect(ctx?.oscillators).toHaveLength(2);
    for (const oscillator of ctx?.oscillators ?? []) {
      expect(oscillator.start).toHaveBeenCalled();
    }

    // Speech is deferred until the chime has rung — nothing spoken yet.
    expect(speech.speak).not.toHaveBeenCalled();

    vi.advanceTimersByTime(CHIME_LEAD_MS);

    expect(speech.speak).toHaveBeenCalledTimes(1);
    const utterance = speech.speak.mock.calls[0]?.[0] as MockSpeechSynthesisUtterance;
    expect(utterance.text).toBe('Now calling number A012');
  });
});

describe('createAnnouncer — chime-only fallback (R7.4, Req 15.1)', () => {
  it('chimes without throwing and never speaks when speech is unavailable', () => {
    // Audio present, but speechSynthesis / SpeechSynthesisUtterance absent
    // (jsdom default — we do NOT stub them here).
    vi.stubGlobal('AudioContext', MockAudioContext);

    expect(isSpeechSupported()).toBe(false);
    expect(isAudioSupported()).toBe(true);

    const announcer = createAnnouncer();
    expect(announcer.isSpeechSupported).toBe(false);
    expect(announcer.isAudioSupported).toBe(true);
    expect(announcer.canAnnounce).toBe(true);

    expect(() => announcer.announce('Now calling number B007')).not.toThrow();

    // The chime still played: oscillators were created and started.
    const ctx = MockAudioContext.instances[0];
    expect(ctx).toBeDefined();
    expect(ctx?.createOscillator).toHaveBeenCalledTimes(2);
    for (const oscillator of ctx?.oscillators ?? []) {
      expect(oscillator.start).toHaveBeenCalled();
    }

    // No speech was scheduled — advancing time produces no speak call (and the
    // fallback path does not even register a timer).
    vi.advanceTimersByTime(CHIME_LEAD_MS * 2);
    expect(typeof window.speechSynthesis).toBe('undefined');
  });
});
