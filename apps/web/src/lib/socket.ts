/*
 * Socket_Client — the single realtime connection for the app (Requirement 3).
 *
 * Responsibilities (steering "Realtime", design "Socket client"):
 * - ONE `socket.io-client` connection per app session on the `/queue` namespace,
 *   created lazily on first use (R3.1).
 * - Dashboard handshake carries the in-memory access token in `auth.token`
 *   (R3.2); when the Auth_Store token changes (after a refresh) the socket
 *   reconnects with the new token (R3.3).
 * - Public surfaces (Display / Kiosk) connect WITHOUT a token and only subscribe
 *   to public `orgId` rooms (R3.4).
 * - A room subscription registry (ref-counted) makes re-subscription on every
 *   reconnect deterministic (R3.7) and keeps the active room set equal to the
 *   rooms of currently-mounted subscribers (design Property 11).
 * - `subscribe` / `unsubscribe` use `WS_EVENTS` from `@queuenow/shared-constants`
 *   (R3.5, R3.10) — no hardcoded event-name string literals.
 * - The event bridge handles `queue:update` / `queue:ticket-called` by
 *   invalidating the matching TanStack Query keys via the shared QueryClient.
 *   TanStack Query is the single source of truth — this module never keeps a
 *   parallel queue-state store (R3.6).
 * - Connection status is exposed via a tiny Zustand store for the reconnecting
 *   indicator (R3.11); the indicator component + polling fallback are task 3.2.
 */
import { io, type Socket } from 'socket.io-client';
import { create } from 'zustand';
import { WS_EVENTS } from '@queuenow/shared-constants';
import type { IQueueUpdateEvent, ITicketCalledEvent } from '@queuenow/shared-types';
import type { QueryKey } from '@tanstack/react-query';

import { queryClient } from '@/lib/api/query-client';
import { queryKeys } from '@/lib/api/query-keys';
import { env } from '@/lib/env';
import { useAuthStore } from '@/features/auth/stores/auth-store';

/** The socket.io namespace every surface connects to. */
const QUEUE_NAMESPACE = '/queue';

/**
 * Which surface owns the connection. Dashboard connections carry the access
 * token in the handshake; public (Display / Kiosk) connections do not.
 */
export type SocketMode = 'dashboard' | 'public';

/**
 * A room a surface can subscribe to. `serviceId` narrows the org room to a
 * single service; omitting it subscribes to the whole org. Mirrors the server
 * gateway payload `{ orgId, serviceId? }`.
 */
export interface RoomDescriptor {
  /** The organization whose queue updates are wanted. */
  orgId: string;
  /** Optional service to scope the subscription to a single service room. */
  serviceId?: string;
}

/** Connection lifecycle as surfaced to the UI (drives the reconnecting indicator). */
export type SocketStatus = 'idle' | 'connecting' | 'connected' | 'reconnecting' | 'disconnected';

/** Zustand store shape for the observable connection status. */
interface SocketStatusState {
  /** Current connection status. */
  status: SocketStatus;
  /** Replace the current status. */
  setStatus: (status: SocketStatus) => void;
}

/**
 * Tiny Zustand store exposing the live connection status. The
 * `<ConnectionIndicator>` (task 3.2) and the polling fallback subscribe to this;
 * it deliberately holds no queue data (TanStack Query owns server state).
 */
export const useSocketStatus = create<SocketStatusState>((set) => ({
  status: 'idle',
  setStatus: (status) => set({ status }),
}));

/** Update the shared status store from outside React. */
function setStatus(status: SocketStatus): void {
  useSocketStatus.getState().setStatus(status);
}

/** Read the current connection status outside React (e.g. for the polling fallback). */
export function getSocketStatus(): SocketStatus {
  return useSocketStatus.getState().status;
}

/**
 * A tracked room plus a reference count. The count equals the number of
 * currently-mounted subscribers for that room, so the room stays subscribed
 * while at least one subscriber is mounted and is released when the last
 * unmounts (design Property 11).
 */
interface RegistryEntry {
  descriptor: RoomDescriptor;
  count: number;
}

/** The subscription registry: serialized room key → entry. Module-scoped singleton. */
const subscriptionRegistry = new Map<string, RegistryEntry>();

/** Stable key for a room descriptor used to dedupe registry entries. */
function roomKey(descriptor: RoomDescriptor): string {
  return `${descriptor.orgId}::${descriptor.serviceId ?? ''}`;
}

/** The single connection for the session, or `null` before the first connect. */
let socket: Socket | null = null;

/** The mode the active connection was created with. */
let activeMode: SocketMode | null = null;

/** Unsubscribe handle for the Auth_Store token listener (dashboard mode only). */
let authUnsubscribe: (() => void) | null = null;

/**
 * Re-emit `subscribe` for every room currently in the registry. Called on each
 * (re)connect so subscriptions are restored deterministically after a drop
 * (R3.7) and established for rooms added while disconnected.
 */
function resubscribeAll(active: Socket): void {
  for (const { descriptor } of subscriptionRegistry.values()) {
    active.emit(WS_EVENTS.SUBSCRIBE, {
      orgId: descriptor.orgId,
      serviceId: descriptor.serviceId,
    });
  }
}

/**
 * Compute the query keys to invalidate for an incoming queue event.
 *
 * The wire payloads do not carry an `orgId` (the server scopes delivery by
 * room), so the subscribed rooms in the registry tell us which orgs are
 * relevant. A `queue:update` carries `ticket.serviceId`; we invalidate the key
 * for every tracked room that the event could affect:
 *  - org-level rooms (`serviceId` undefined) are always affected;
 *  - service-level rooms are affected only when the event's service matches.
 * `queue:ticket-called` has no service scope, so all tracked rooms match.
 *
 * Exported for the socket-bridge property test (task 3.3) — pure and
 * deterministic so it can be exercised without a live socket.
 *
 * @param rooms - the currently-tracked room descriptors.
 * @param eventServiceId - the service the event pertains to, if any.
 * @returns the de-duplicated list of query keys to invalidate.
 */
export function queueKeysForEvent(
  rooms: readonly RoomDescriptor[],
  eventServiceId: string | undefined,
): QueryKey[] {
  const keys = new Map<string, QueryKey>();
  for (const room of rooms) {
    const affected =
      eventServiceId === undefined ||
      room.serviceId === undefined ||
      room.serviceId === eventServiceId;
    if (!affected) {
      continue;
    }
    const key = queryKeys.queue(room.orgId, room.serviceId);
    keys.set(roomKey(room), key);
  }
  return Array.from(keys.values());
}

/** Invalidate the matching queue query keys for an event's service scope (R3.6). */
function invalidateForEvent(eventServiceId: string | undefined): void {
  const rooms = Array.from(subscriptionRegistry.values(), (entry) => entry.descriptor);
  for (const queryKey of queueKeysForEvent(rooms, eventServiceId)) {
    void queryClient.invalidateQueries({ queryKey });
  }
}

/**
 * Attach the connection-status and event-bridge listeners to a freshly created
 * socket. Done once per connection (the socket is a session singleton).
 */
function attachListeners(active: Socket): void {
  // Connection lifecycle → status store. `connect` fires on the initial
  // connection AND every reconnection, so re-subscription lives here (R3.7).
  active.on('connect', () => {
    setStatus('connected');
    resubscribeAll(active);
  });

  active.on('disconnect', () => {
    setStatus('disconnected');
  });

  // Manager-level reconnection signals drive the "reconnecting" indicator (R3.11).
  active.io.on('reconnect_attempt', () => {
    setStatus('reconnecting');
  });
  active.io.on('error', () => {
    // Only downgrade to "reconnecting" while we still have a connection target;
    // a hard `disconnect` is handled above.
    if (getSocketStatus() !== 'disconnected') {
      setStatus('reconnecting');
    }
  });

  // Event bridge → TanStack Query invalidation (R3.6). No parallel store.
  active.on(WS_EVENTS.QUEUE_UPDATE, (payload: IQueueUpdateEvent) => {
    invalidateForEvent(payload.ticket?.serviceId);
  });
  active.on(WS_EVENTS.TICKET_CALLED, (_payload: ITicketCalledEvent) => {
    // `queue:ticket-called` is org-scoped (no serviceId on the wire), so it
    // refreshes every tracked room for the org(s) in the registry.
    invalidateForEvent(undefined);
  });
}

/** Build the handshake `auth` payload for the given mode. */
function buildAuth(mode: SocketMode): Record<string, unknown> | undefined {
  if (mode !== 'dashboard') {
    return undefined;
  }
  const token = useAuthStore.getState().accessToken;
  return token ? { token } : {};
}

/**
 * Watch the Auth_Store for access-token changes and reconnect the dashboard
 * socket with the new token (R3.3). Public connections ignore the token.
 */
function watchTokenChanges(): void {
  if (authUnsubscribe) {
    return;
  }
  authUnsubscribe = useAuthStore.subscribe((state, prev) => {
    if (activeMode !== 'dashboard' || socket === null) {
      return;
    }
    if (state.accessToken === prev.accessToken) {
      return;
    }
    socket.auth = state.accessToken ? { token: state.accessToken } : {};
    // Bounce the connection so the handshake re-runs with the new token.
    socket.disconnect().connect();
  });
}

/**
 * Ensure the session socket exists and is connecting/connected, creating it
 * lazily on first call (R3.1). The first call fixes the connection {@link
 * SocketMode} for the session.
 *
 * @param mode - `'dashboard'` (token handshake) or `'public'` (token-less).
 * @returns the session socket.
 */
export function ensureSocket(mode: SocketMode): Socket {
  if (socket) {
    return socket;
  }

  activeMode = mode;
  setStatus('connecting');

  socket = io(`${env.VITE_WS_URL}${QUEUE_NAMESPACE}`, {
    auth: buildAuth(mode),
    // socket.io auto-reconnect with backoff (steering "Realtime resilience").
    reconnection: true,
    transports: ['websocket'],
  });

  attachListeners(socket);
  if (mode === 'dashboard') {
    watchTokenChanges();
  }

  return socket;
}

/** Return the session socket if it has been created, otherwise `null`. */
export function getSocket(): Socket | null {
  return socket;
}

/**
 * Subscribe to a room. Ref-counted: the first subscriber for a room emits
 * `subscribe`; later subscribers just increment the count. If the socket is not
 * yet connected, the room is recorded and (re)subscribed on the next `connect`.
 *
 * @param descriptor - the org (and optional service) room to join.
 */
export function subscribeRoom(descriptor: RoomDescriptor): void {
  const key = roomKey(descriptor);
  const existing = subscriptionRegistry.get(key);

  if (existing) {
    existing.count += 1;
    return;
  }

  subscriptionRegistry.set(key, { descriptor, count: 1 });

  if (socket?.connected) {
    socket.emit(WS_EVENTS.SUBSCRIBE, {
      orgId: descriptor.orgId,
      serviceId: descriptor.serviceId,
    });
  }
}

/**
 * Release a room subscription. Ref-counted: only the last subscriber for a room
 * emits `unsubscribe` and drops it from the registry (R3.10, Property 11).
 *
 * @param descriptor - the room to release.
 */
export function unsubscribeRoom(descriptor: RoomDescriptor): void {
  const key = roomKey(descriptor);
  const existing = subscriptionRegistry.get(key);

  if (!existing) {
    return;
  }

  existing.count -= 1;
  if (existing.count > 0) {
    return;
  }

  subscriptionRegistry.delete(key);

  if (socket?.connected) {
    socket.emit(WS_EVENTS.UNSUBSCRIBE, {
      orgId: descriptor.orgId,
      serviceId: descriptor.serviceId,
    });
  }
}

/** Snapshot of the rooms with at least one mounted subscriber (for tests/diagnostics). */
export function getSubscribedRooms(): RoomDescriptor[] {
  return Array.from(subscriptionRegistry.values(), (entry) => entry.descriptor);
}

/**
 * Tear down the session connection and all bookkeeping. Primarily for tests and
 * full sign-out; normal navigation relies on the ref-counted hook lifecycle.
 */
export function disconnectSocket(): void {
  if (authUnsubscribe) {
    authUnsubscribe();
    authUnsubscribe = null;
  }
  if (socket) {
    socket.removeAllListeners();
    socket.io.removeAllListeners();
    socket.disconnect();
    socket = null;
  }
  activeMode = null;
  subscriptionRegistry.clear();
  setStatus('idle');
}
