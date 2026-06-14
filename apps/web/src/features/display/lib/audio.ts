/*
 * Audio announcer utility for the public Display (TV) board (R7.4).
 *
 * The board announces each newly-called ticket by playing a short chime and
 * then speaking the ticket number + counter via the Web Speech API
 * (`speechSynthesis`). When speech synthesis is unavailable, it degrades to the
 * chime alone (R7.4).
 *
 * Everything here is feature-detected and guarded so it is safe to construct and
 * call in environments that lack the browser audio APIs (e.g. jsdom under
 * Vitest, or older browsers): unsupported capabilities simply no-op rather than
 * throw. Nothing touches `window.speechSynthesis` or constructs an
 * `AudioContext` at module load — the context is created lazily on first use,
 * and only after a user gesture unlock (browsers block audio until then, R7.6).
 */

/** A constructor for an `AudioContext`, including the legacy webkit-prefixed one. */
type AudioContextConstructor = new () => AudioContext;

/** Window augmented with the optional webkit-prefixed `AudioContext`. */
interface AudioCapableWindow {
  AudioContext?: AudioContextConstructor;
  webkitAudioContext?: AudioContextConstructor;
}

/** Resolve a usable `AudioContext` constructor for the host, or `null`. */
function getAudioContextCtor(): AudioContextConstructor | null {
  if (typeof window === 'undefined') {
    return null;
  }
  const candidate = window as unknown as AudioCapableWindow;
  return candidate.AudioContext ?? candidate.webkitAudioContext ?? null;
}

/** Whether the Web Speech API (`speechSynthesis`) is available in this host. */
export function isSpeechSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.speechSynthesis !== 'undefined' &&
    typeof window.SpeechSynthesisUtterance === 'function'
  );
}

/** Whether the Web Audio API (for the chime) is available in this host. */
export function isAudioSupported(): boolean {
  return getAudioContextCtor() !== null;
}

/**
 * Imperative announcer for the Display board. Created once per board via
 * {@link createAnnouncer} and driven by the `useAnnouncer` hook.
 */
export interface Announcer {
  /** Whether a chime can be played (Web Audio API available). */
  readonly isAudioSupported: boolean;
  /** Whether spoken announcements are available (Web Speech API). */
  readonly isSpeechSupported: boolean;
  /** Whether the announcer can produce any sound at all (chime or speech). */
  readonly canAnnounce: boolean;
  /**
   * Unlock audio from a user gesture (R7.6): resume the `AudioContext` and prime
   * the speech engine so later announcements are allowed to play.
   */
  unlock: () => void;
  /**
   * Announce a called ticket: play the chime, then speak `text` once the chime
   * has rung. Falls back to the chime alone when speech is unavailable (R7.4).
   */
  announce: (text: string) => void;
  /** Stop any in-progress/queued speech (e.g. on unmount or mute). */
  cancel: () => void;
}

/** Approximate length of the chime, after which the spoken text begins. */
const CHIME_LEAD_MS = 520;

/**
 * Create an {@link Announcer}. Pure construction — no browser APIs are touched
 * until {@link Announcer.unlock} / {@link Announcer.announce} are called, and
 * every call is guarded so this is safe under jsdom and unsupported browsers.
 */
export function createAnnouncer(): Announcer {
  const AudioCtor = getAudioContextCtor();
  const audioSupported = AudioCtor !== null;
  const speechSupported = isSpeechSupported();

  let context: AudioContext | null = null;

  /** Lazily create (once) the shared AudioContext. */
  function ensureContext(): AudioContext | null {
    if (!AudioCtor) {
      return null;
    }
    if (!context) {
      try {
        context = new AudioCtor();
      } catch {
        context = null;
      }
    }
    return context;
  }

  /** Play a short two-tone "ding-dong" chime through the Web Audio API. */
  function playChime(): void {
    const ctx = ensureContext();
    if (!ctx) {
      return;
    }
    try {
      if (ctx.state === 'suspended') {
        void ctx.resume();
      }
      const startedAt = ctx.currentTime;
      const gain = ctx.createGain();
      gain.connect(ctx.destination);
      // Soft attack/decay envelope so the chime is pleasant, not a click.
      gain.gain.setValueAtTime(0.0001, startedAt);
      gain.gain.exponentialRampToValueAtTime(0.2, startedAt + 0.05);
      gain.gain.exponentialRampToValueAtTime(0.0001, startedAt + 0.5);

      const tones = [880, 1318.5];
      for (let i = 0; i < tones.length; i += 1) {
        const frequency = tones[i] ?? 880;
        const toneStart = startedAt + i * 0.18;
        const oscillator = ctx.createOscillator();
        oscillator.type = 'sine';
        oscillator.frequency.setValueAtTime(frequency, toneStart);
        oscillator.connect(gain);
        oscillator.start(toneStart);
        oscillator.stop(toneStart + 0.24);
      }
    } catch {
      // Ignore: audio output may be unavailable or blocked; the board still
      // updates visually.
    }
  }

  /** Speak `text` via the Web Speech API, if supported. */
  function speak(text: string): void {
    if (!speechSupported || text.length === 0) {
      return;
    }
    try {
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.rate = 0.95;
      utterance.pitch = 1;
      utterance.volume = 1;
      window.speechSynthesis.speak(utterance);
    } catch {
      // Ignore: speech may be unavailable despite the feature check.
    }
  }

  function unlock(): void {
    const ctx = ensureContext();
    if (ctx && ctx.state === 'suspended') {
      void ctx.resume();
    }
    if (speechSupported) {
      try {
        // Prime the speech engine with a near-silent utterance so the first
        // real announcement is not swallowed by the gesture-unlock requirement.
        window.speechSynthesis.resume();
        const primer = new SpeechSynthesisUtterance(' ');
        primer.volume = 0;
        window.speechSynthesis.speak(primer);
      } catch {
        // Ignore: priming is best-effort.
      }
    }
  }

  function announce(text: string): void {
    playChime();
    if (!speechSupported) {
      // Chime-only fallback (R7.4).
      return;
    }
    // Let the chime ring before speaking so they do not overlap.
    window.setTimeout(() => {
      speak(text);
    }, CHIME_LEAD_MS);
  }

  function cancel(): void {
    if (speechSupported) {
      try {
        window.speechSynthesis.cancel();
      } catch {
        // Ignore.
      }
    }
  }

  return {
    isAudioSupported: audioSupported,
    isSpeechSupported: speechSupported,
    canAnnounce: audioSupported || speechSupported,
    unlock,
    announce,
    cancel,
  };
}
