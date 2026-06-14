/**
 * Mock socket + emitter (boundary harness — task 2.4).
 *
 * A lightweight test double for the `socket.io-client` `Socket` surface the
 * Realtime_Client (`src/lib/socket.ts`) relies on, so the subscription
 * lifecycle / reconnect / bridge behavior (Properties 6–9) can be driven without
 * a live socket server. It supports:
 *
 *  - `on`/`off`/`emit` with a recorded log of OUTGOING emits (`emitted`) — the
 *    `subscribe`/`subscribe:ticket`/`unsubscribe` the client sends.
 *  - `connected`, `connect()`, `disconnect()` returning the socket (chainable as
 *    the client expects), toggling state and dispatching `connect`/`disconnect`.
 *  - An `io` manager sub-emitter for manager-level events (`reconnect_attempt`).
 *  - Test drivers: {@link FakeSocket.serverEmit} (simulate a server→client event
 *    such as `ticket:update` / `ticket:notification`) and
 *    {@link FakeSocket.emitManager} (simulate a manager event).
 *
 * The double is intentionally structural: {@link FakeSocket.asSocket} returns it
 * typed as the production `Socket` (via `unknown`) for functions that accept one
 * (e.g. `resubscribeAll(socket)`), without depending on socket.io internals.
 */
import type { Socket } from 'socket.io-client';

/** A recorded outgoing emit (client → server). */
export interface EmittedEvent {
  /** The event name emitted (a `WS_EVENTS` value in production). */
  event: string;
  /** The argument(s) passed to `emit`. */
  args: unknown[];
}

type Listener = (...args: unknown[]) => void;

/** A tiny event registry shared by the socket and its `io` manager. */
class Emitter {
  private readonly listeners = new Map<string, Set<Listener>>();

  on(event: string, listener: Listener): void {
    const set = this.listeners.get(event) ?? new Set<Listener>();
    set.add(listener);
    this.listeners.set(event, set);
  }

  off(event: string, listener?: Listener): void {
    if (!listener) {
      this.listeners.delete(event);
      return;
    }
    this.listeners.get(event)?.delete(listener);
  }

  dispatch(event: string, args: unknown[]): void {
    for (const listener of this.listeners.get(event) ?? []) {
      listener(...args);
    }
  }

  clear(): void {
    this.listeners.clear();
  }
}

/** The fake `io` manager exposing the subset the client uses (`.on`). */
class FakeManager {
  readonly emitter = new Emitter();

  on(event: string, listener: Listener): this {
    this.emitter.on(event, listener);
    return this;
  }

  removeAllListeners(): this {
    this.emitter.clear();
    return this;
  }
}

/** A controllable `socket.io-client` `Socket` double. */
export class FakeSocket {
  /** Whether the socket is currently "connected". */
  public connected: boolean;
  /** The fake manager (`socket.io`). */
  public readonly io = new FakeManager();
  /** Every outgoing emit the client made, in order. */
  public readonly emitted: EmittedEvent[] = [];

  private readonly emitter = new Emitter();

  constructor(options: { connected?: boolean } = {}) {
    this.connected = options.connected ?? false;
  }

  // ---- Socket surface used by the production client -----------------------

  on(event: string, listener: Listener): this {
    this.emitter.on(event, listener);
    return this;
  }

  off(event: string, listener?: Listener): this {
    this.emitter.off(event, listener);
    return this;
  }

  emit(event: string, ...args: unknown[]): this {
    this.emitted.push({ event, args });
    return this;
  }

  connect(): this {
    if (!this.connected) {
      this.connected = true;
      this.emitter.dispatch('connect', []);
    }
    return this;
  }

  disconnect(): this {
    if (this.connected) {
      this.connected = false;
      this.emitter.dispatch('disconnect', ['io client disconnect']);
    }
    return this;
  }

  removeAllListeners(): this {
    this.emitter.clear();
    return this;
  }

  // ---- Test drivers -------------------------------------------------------

  /** Simulate a server→client event reaching `.on(event)` listeners. */
  serverEmit(event: string, ...args: unknown[]): void {
    this.emitter.dispatch(event, args);
  }

  /** Simulate a manager-level event reaching `io.on(event)` listeners. */
  emitManager(event: string, ...args: unknown[]): void {
    this.io.emitter.dispatch(event, args);
  }

  /** Outgoing emits filtered to a single event name (assertion helper). */
  emitsFor(event: string): EmittedEvent[] {
    return this.emitted.filter((e) => e.event === event);
  }

  /** Clear the recorded outgoing-emit log. */
  clearEmitted(): void {
    this.emitted.length = 0;
  }

  /** This double typed as the production `Socket` (for functions that take one). */
  asSocket(): Socket {
    return this as unknown as Socket;
  }
}

/** Convenience factory mirroring the other harness builders. */
export function createFakeSocket(options: { connected?: boolean } = {}): FakeSocket {
  return new FakeSocket(options);
}
