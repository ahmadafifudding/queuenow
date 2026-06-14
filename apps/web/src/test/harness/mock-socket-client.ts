/*
 * Mock Socket_Client (task 2.4, Requirement 15.1).
 *
 * An in-memory boundary double for `lib/socket.ts`. It reproduces that module's
 * observable surface so tests can exercise the event bridge, the subscription
 * lifecycle, and the polling fallback WITHOUT a real socket.io connection:
 *
 * - Ref-counted room registry with the SAME semantics as `subscribeRoom` /
 *   `unsubscribeRoom`: the first subscriber for a room emits `subscribe`, later
 *   subscribers just bump the count, and only the last `unsubscribe` releases it.
 * - Connection-state transitions (`connect` / `disconnect` / `reconnecting`)
 *   that drive the same `SocketStatus` values the UI reads, and a `connect`
 *   that re-emits `subscribe` for every tracked room (mirrors `resubscribeAll`,
 *   R3.7) so reconnect behavior (design Property 11) is testable.
 * - Test-only emit helpers (`emitQueueUpdate` / `emitTicketCalled`) that push
 *   synthetic server→client events. When bridged to a `QueryClient`, they
 *   invalidate exactly the keys `lib/socket.ts` would, by reusing the real
 *   `queueKeysForEvent` so the double can never drift from production mapping.
 * - Recorded client→server emissions (`getSentMessages`) so tests can assert
 *   that (re)subscription happened.
 *
 * This is a transport double only: the key-selection logic it bridges with is
 * the real `queueKeysForEvent`, so consuming tests assert their own behavior,
 * not a reimplementation.
 */
import { WS_EVENTS } from '@queuenow/shared-constants';
import type { IQueueUpdateEvent, ITicketCalledEvent } from '@queuenow/shared-types';
import type { QueryClient } from '@tanstack/react-query';

import { queueKeysForEvent, type RoomDescriptor, type SocketStatus } from '@/lib/socket';

/** A recorded client→server emission (subscribe / unsubscribe to a room). */
export interface SentMessage {
  /** The emitted event name (`subscribe` or `unsubscribe`). */
  event: string;
  /** The room descriptor carried by the emission. */
  descriptor: RoomDescriptor;
}

/** A captured server→client event handler registered via {@link MockSocketClient.on}. */
export type EventHandler = (payload: unknown) => void;

/** The public mock socket surface returned by {@link createMockSocketClient}. */
export interface MockSocketClient {
  // --- connection status ---------------------------------------------------
  /** Current connection status. */
  getStatus(): SocketStatus;
  /** Force a specific status (escape hatch for edge-case tests). */
  setStatus(status: SocketStatus): void;
  /** Transition to `connected` and re-emit `subscribe` for every tracked room. */
  connect(): void;
  /** Transition to `disconnected`. */
  disconnect(): void;
  /** Transition to `reconnecting`. */
  reconnecting(): void;
  /** Subscribe to status changes; returns an unsubscribe function. */
  onStatusChange(listener: (status: SocketStatus) => void): () => void;

  // --- room subscription registry (ref-counted) ----------------------------
  /** Subscribe to a room (ref-counted; emits `subscribe` only for the first subscriber). */
  subscribeRoom(descriptor: RoomDescriptor): void;
  /** Release a room (ref-counted; emits `unsubscribe` only for the last subscriber). */
  unsubscribeRoom(descriptor: RoomDescriptor): void;
  /** Snapshot of the rooms with at least one mounted subscriber. */
  getSubscribedRooms(): RoomDescriptor[];
  /** Recorded client→server emissions, in order. */
  getSentMessages(): readonly SentMessage[];

  // --- event bridge --------------------------------------------------------
  /** Wire emitted queue events into a `QueryClient` (same invalidation as `lib/socket.ts`). */
  bridgeTo(queryClient: QueryClient): void;
  /** Emit a synthetic `queue:update` event (invalidates the matching keys when bridged). */
  emitQueueUpdate(payload: IQueueUpdateEvent): void;
  /** Emit a synthetic `queue:ticket-called` event (org-scoped invalidation when bridged). */
  emitTicketCalled(payload: ITicketCalledEvent): void;
  /** Register a raw server→client event handler (for advanced/custom events). */
  on(event: string, handler: EventHandler): void;
  /** Remove a previously registered handler. */
  off(event: string, handler: EventHandler): void;

  /** Clear status, registry, sent messages, handlers, and the bridged client. */
  reset(): void;
}

interface RegistryEntry {
  descriptor: RoomDescriptor;
  count: number;
}

/** Stable key for a room descriptor (matches `lib/socket.ts`). */
function roomKey(descriptor: RoomDescriptor): string {
  return `${descriptor.orgId}::${descriptor.serviceId ?? ''}`;
}

/**
 * Create a mock Socket_Client.
 *
 * @returns a {@link MockSocketClient} for driving realtime behavior in tests.
 */
export function createMockSocketClient(): MockSocketClient {
  const registry = new Map<string, RegistryEntry>();
  const sentMessages: SentMessage[] = [];
  const statusListeners = new Set<(status: SocketStatus) => void>();
  const eventHandlers = new Map<string, Set<EventHandler>>();

  let status: SocketStatus = 'idle';
  let connected = false;
  let queryClient: QueryClient | null = null;

  function setStatus(next: SocketStatus): void {
    status = next;
    for (const listener of statusListeners) {
      listener(next);
    }
  }

  function record(event: string, descriptor: RoomDescriptor): void {
    sentMessages.push({ event, descriptor });
  }

  function trackedRooms(): RoomDescriptor[] {
    return Array.from(registry.values(), (entry) => entry.descriptor);
  }

  function invalidateForEvent(eventServiceId: string | undefined): void {
    if (queryClient === null) {
      return;
    }
    for (const queryKey of queueKeysForEvent(trackedRooms(), eventServiceId)) {
      void queryClient.invalidateQueries({ queryKey });
    }
  }

  function dispatch(event: string, payload: unknown): void {
    const handlers = eventHandlers.get(event);
    if (!handlers) {
      return;
    }
    for (const handler of handlers) {
      handler(payload);
    }
  }

  return {
    getStatus() {
      return status;
    },
    setStatus(next) {
      connected = next === 'connected';
      setStatus(next);
    },
    connect() {
      connected = true;
      setStatus('connected');
      // Re-emit subscribe for every tracked room (mirrors resubscribeAll, R3.7).
      for (const { descriptor } of registry.values()) {
        record(WS_EVENTS.SUBSCRIBE, descriptor);
      }
    },
    disconnect() {
      connected = false;
      setStatus('disconnected');
    },
    reconnecting() {
      connected = false;
      setStatus('reconnecting');
    },
    onStatusChange(listener) {
      statusListeners.add(listener);
      return () => {
        statusListeners.delete(listener);
      };
    },

    subscribeRoom(descriptor) {
      const key = roomKey(descriptor);
      const existing = registry.get(key);
      if (existing) {
        existing.count += 1;
        return;
      }
      registry.set(key, { descriptor, count: 1 });
      if (connected) {
        record(WS_EVENTS.SUBSCRIBE, descriptor);
      }
    },
    unsubscribeRoom(descriptor) {
      const key = roomKey(descriptor);
      const existing = registry.get(key);
      if (!existing) {
        return;
      }
      existing.count -= 1;
      if (existing.count > 0) {
        return;
      }
      registry.delete(key);
      if (connected) {
        record(WS_EVENTS.UNSUBSCRIBE, descriptor);
      }
    },
    getSubscribedRooms() {
      return trackedRooms();
    },
    getSentMessages() {
      return sentMessages;
    },

    bridgeTo(client) {
      queryClient = client;
    },
    emitQueueUpdate(payload) {
      invalidateForEvent(payload.ticket?.serviceId);
      dispatch(WS_EVENTS.QUEUE_UPDATE, payload);
    },
    emitTicketCalled(payload) {
      // `queue:ticket-called` is org-scoped (no serviceId on the wire).
      invalidateForEvent(undefined);
      dispatch(WS_EVENTS.TICKET_CALLED, payload);
    },
    on(event, handler) {
      let handlers = eventHandlers.get(event);
      if (!handlers) {
        handlers = new Set();
        eventHandlers.set(event, handlers);
      }
      handlers.add(handler);
    },
    off(event, handler) {
      eventHandlers.get(event)?.delete(handler);
    },

    reset() {
      registry.clear();
      sentMessages.length = 0;
      statusListeners.clear();
      eventHandlers.clear();
      status = 'idle';
      connected = false;
      queryClient = null;
    },
  };
}
