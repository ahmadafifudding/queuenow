/*
 * Realtime_Client — the single realtime connection for the customer app
 * (Requirements 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 3.3, 9.3).
 *
 * Responsibilities (design "Realtime Client"):
 * - ONE `socket.io-client` connection per app session on the `/queue` namespace,
 *   created lazily on first use. This is the CUSTOMER app: it connects PUBLICLY
 *   (token-less). Ticket/room subscriptions are public, so no handshake auth is
 *   sent (contrast with `apps/web`'s dashboard handshake token).
 * - A ref-counted subscription registry (see `socket-registry.ts`) makes
 *   re-subscription on every reconnect deterministic. The first subscriber for
 *   a ticket/room emits exactly one `subscribe:ticket`/`subscribe`; the last
 *   `unsubscribeRoom` emits exactly one `unsubscribe` (R4.1–R4.3).
 * - Subscribe/unsubscribe use `WS_EVENTS` from `@queuenow/shared-constants`
 *   only — no hardcoded event-name string literals (R4.6).
 * - On every `connect` (initial AND reconnect) it re-emits `subscribe`/
 *   `subscribe:ticket` for every tracked entry (R4.4 re-subscribe-on-reconnect).
 * - Bridge (R3.3): on `ticket:update` for a tracked ticket, it invalidates
 *   `queryKeys.ticket(orgId, ticketId)` so REST stays the single source of truth
 *   (no parallel queue store). On `ticket:notification` it forwards the payload
 *   to registered listeners (the Notification_Manager, task 6.1) — this module
 *   implements NO notification logic, only the subscription point.
 * - Connection status is exposed via a tiny Zustand store for the reconnecting
 *   indicator / offline UI.
 *
 * TASK 3.2 — bounded connect-and-resubscribe retry + reconnect triggers
 * (R4.4/R4.5/R9.3):
 * - socket.io's built-in auto-reconnect is DISABLED (`reconnection: false`) so
 *   the {@link ReconnectController} fully owns the connect-and-resubscribe
 *   lifecycle. After each (re)connect it re-issues every tracked subscription
 *   (preserving 3.1's `resubscribeAll`) and then awaits acknowledgement within a
 *   short window (`subscribed` ack for rooms; ticket subs need no server ack).
 * - If re-subscription is not acknowledged, the reconnection is treated as
 *   FAILED and the WHOLE connect-and-resubscribe cycle is retried with bounded
 *   exponential backoff (`retryDelay`/`canRetry` from `socket-registry.ts`).
 *   When attempts are exhausted, status settles on `disconnected` and the
 *   `manualReconnectAvailable` flag is raised so the UI can offer a manual
 *   reconnect affordance.
 * - Reconnect TRIGGERS (R4.4): socket connection loss (`disconnect`), a NetInfo
 *   connectivity-change to connected, an `AppState` → `active` transition, and an
 *   explicit user-initiated {@link reconnectNow}. The NetInfo/AppState triggers
 *   are wired through the connectivity bridge's store and are INJECTABLE via
 *   {@link initSocketReconnect} (sources + scheduler + policy) so the wiring is
 *   testable without a device or real timers.
 * - The pure schedule (`retryDelay`), the bounded-attempts decision (`canRetry`)
 *   and the re-subscribe acknowledgement decision (`isResubscribeAcknowledged`)
 *   live in `socket-registry.ts` so Property 9 (task 3.6) tests them directly.
 */
import { io, type Socket } from 'socket.io-client';
import { create } from 'zustand';
import { WS_EVENTS } from '@queuenow/shared-constants';
import type { IQueueUpdateEvent } from '@queuenow/shared-types';

import { queryClient } from '@/lib/api/query-client';
import { connectivityStore } from '@/lib/connectivity';
import { env } from '@/lib/env';
import {
  canRetry,
  DEFAULT_RETRY_POLICY,
  isResubscribeAcknowledged,
  queueKeysForEvent,
  retryDelay,
  SubscriptionRegistry,
  type RetryPolicy,
  type TrackedRoom,
} from '@/lib/socket-registry';

// Re-export the pure helpers so consumers/tests can import them from the client
// module too (the property tests in 3.3–3.6 may target either entry point).
export {
  canRetry,
  DEFAULT_RETRY_POLICY,
  isResubscribeAcknowledged,
  queueKeysForEvent,
  retryDelay,
  SubscriptionRegistry,
} from '@/lib/socket-registry';
export type { RetryPolicy, TrackedRoom, TrackedTicket } from '@/lib/socket-registry';

/** The socket.io namespace every surface connects to. */
const QUEUE_NAMESPACE = '/queue';

/**
 * How long (ms) to wait for re-subscription acknowledgement after a (re)connect
 * before treating the reconnection as failed (R4.5). Overridable via
 * {@link initSocketReconnect} for tests.
 */
const DEFAULT_ACK_WINDOW_MS = 3_000;

/**
 * A room a surface can subscribe to. `serviceId` narrows the org room to a
 * single service; omitting it subscribes to the whole org. Mirrors the gateway
 * payload `{ orgId, serviceId? }`. Public alias of {@link TrackedRoom}.
 */
export type RoomSubscription = TrackedRoom;

/** Connection lifecycle as surfaced to the UI (drives the reconnecting indicator). */
export type SocketStatus = 'idle' | 'connecting' | 'connected' | 'reconnecting' | 'disconnected';

/** Payload handed to `ticket:notification` listeners (Notification_Manager, task 6.1). */
export type TicketNotificationPayload = Record<string, unknown>;

/** A registered `ticket:notification` listener. */
export type TicketNotificationListener = (payload: TicketNotificationPayload) => void;

/** A scheduled-timer handle, abstracted so tests can inject a fake scheduler. */
export type TimerHandle = ReturnType<typeof setTimeout>;

/**
 * Injectable timer scheduler. The default binds the host `setTimeout`/
 * `clearTimeout`; the bounded-retry tests provide a fake to drive the backoff
 * deterministically without real time passing.
 */
export interface Scheduler {
  /** Schedule `fn` after `ms` and return a handle. */
  set: (fn: () => void, ms: number) => TimerHandle;
  /** Cancel a previously-scheduled handle. */
  clear: (handle: TimerHandle) => void;
}

/** Default scheduler bound to the host timer functions. */
const defaultScheduler: Scheduler = {
  set: (fn, ms) => setTimeout(fn, ms),
  clear: (handle) => clearTimeout(handle),
};

/**
 * The slice of the connectivity bridge the reconnect triggers consume. The
 * connectivity store (`lib/connectivity.ts`) satisfies this; tests inject a fake
 * that pushes synthetic online/appState transitions.
 */
export type ConnectivitySource = Pick<typeof connectivityStore, 'getState' | 'subscribe'>;

/** Zustand store shape for the observable connection status. */
interface SocketStatusState {
  /** Current connection status. */
  status: SocketStatus;
  /**
   * Whether retries are exhausted and a manual reconnect is the way forward
   * (R4.5). The UI shows a manual-reconnect affordance while this is `true`.
   */
  manualReconnectAvailable: boolean;
  /** Replace the current status. */
  setStatus: (status: SocketStatus) => void;
  /** Set whether the manual-reconnect affordance should be shown. */
  setManualReconnectAvailable: (available: boolean) => void;
}

/**
 * Tiny Zustand store exposing the live connection status. The reconnecting
 * indicator and offline UI subscribe to this; it deliberately holds no queue
 * data (TanStack Query owns server state).
 */
export const useSocketStatus = create<SocketStatusState>((set) => ({
  status: 'idle',
  manualReconnectAvailable: false,
  setStatus: (status) => set({ status }),
  setManualReconnectAvailable: (manualReconnectAvailable) => set({ manualReconnectAvailable }),
}));

/**
 * Update the shared status store from outside React. Exported as a seam so the
 * bounded-retry loop can drive `reconnecting`/`disconnected` transitions.
 */
export function setSocketStatus(status: SocketStatus): void {
  useSocketStatus.getState().setStatus(status);
}

/** Read the current connection status outside React (e.g. for the offline UI). */
export function getSocketStatus(): SocketStatus {
  return useSocketStatus.getState().status;
}

/**
 * Raise/lower the manual-reconnect affordance flag (R4.5). Set `true` when
 * bounded retries are exhausted, cleared whenever a fresh cycle begins.
 */
export function setManualReconnectAvailable(available: boolean): void {
  useSocketStatus.getState().setManualReconnectAvailable(available);
}

/** Whether the UI should currently surface a manual-reconnect affordance. */
export function isManualReconnectAvailable(): boolean {
  return useSocketStatus.getState().manualReconnectAvailable;
}

/** The ref-counted subscription registry: module-scoped singleton. */
const registry = new SubscriptionRegistry();

/** The single connection for the session, or `null` before the first connect. */
let socket: Socket | null = null;

/** Registered `ticket:notification` listeners (Notification_Manager subscription point). */
const notificationListeners = new Set<TicketNotificationListener>();

/** Emit `subscribe:ticket` to the server for a single tracked ticket. */
function emitSubscribeTicket(active: Socket, ticketId: string): void {
  active.emit(WS_EVENTS.SUBSCRIBE_TICKET, { ticketId });
}

/** Emit `subscribe` to the server for a single tracked room. */
function emitSubscribeRoom(active: Socket, room: TrackedRoom): void {
  active.emit(WS_EVENTS.SUBSCRIBE, { orgId: room.orgId, serviceId: room.serviceId });
}

/** Emit `unsubscribe` to the server for a single room. */
function emitUnsubscribeRoom(active: Socket, room: TrackedRoom): void {
  active.emit(WS_EVENTS.UNSUBSCRIBE, { orgId: room.orgId, serviceId: room.serviceId });
}

/**
 * Re-emit `subscribe`/`subscribe:ticket` for every entry currently in the
 * registry (R4.4). Called on each (re)connect so subscriptions are restored
 * deterministically after a drop and established for entries added while
 * disconnected. Exported as the integration seam for the retry loop / tests.
 */
export function resubscribeAll(active: Socket): void {
  for (const ticket of registry.trackedTickets()) {
    emitSubscribeTicket(active, ticket.ticketId);
  }
  for (const room of registry.trackedRooms()) {
    emitSubscribeRoom(active, room);
  }
}

/**
 * Bridge an incoming `ticket:update` event to TanStack Query invalidation
 * (R3.3). The tracked tickets supply the `orgId` the wire payload omits.
 */
function handleTicketUpdate(payload: IQueueUpdateEvent): void {
  for (const queryKey of queueKeysForEvent(payload, registry.trackedTickets())) {
    void queryClient.invalidateQueries({ queryKey });
  }
}

/**
 * Forward a `ticket:notification` payload to every registered listener. This
 * module implements no notification behavior; the Notification_Manager (task
 * 6.1) consumes these via {@link onTicketNotification}.
 */
function handleTicketNotification(payload: TicketNotificationPayload): void {
  for (const listener of notificationListeners) {
    listener(payload);
  }
}

/**
 * The bounded connect-and-resubscribe retry controller (R4.4/R4.5).
 *
 * It coordinates the connect → resubscribe → verify → (retry | settle) cycle and
 * owns all retry timers, decoupled from the socket I/O it drives (which lives in
 * the module functions). Dependencies — the backoff `policy`, the ack-window
 * length, the `scheduler`, and the `connectivity` source — are injected so the
 * whole loop is testable without a device or real time. The pure decisions
 * (`retryDelay`, `canRetry`, `isResubscribeAcknowledged`) come from
 * `socket-registry.ts`.
 */
class ReconnectController {
  private readonly policy: RetryPolicy;
  private readonly ackWindowMs: number;
  private readonly scheduler: Scheduler;
  private readonly connectivity: ConnectivitySource;

  /** Count of connect-and-resubscribe cycles that have failed in the run. */
  private attemptsMade = 0;
  /** `subscribed` acks observed within the current verification window. */
  private roomAcksReceived = 0;
  /** Whether a verification window is currently open. */
  private verifying = false;
  /** Whether a bounded retry cycle is currently in progress. */
  private cycleActive = false;
  /** When `true`, the next `disconnect` event is an intentional teardown. */
  private suppressDisconnect = false;
  /** Once disposed, all callbacks become no-ops. */
  private disposed = false;
  /** Pending ack-window timer, or `null`. */
  private ackTimer: TimerHandle | null = null;
  /** Pending backoff retry timer, or `null`. */
  private retryTimer: TimerHandle | null = null;
  /** Connectivity-store unsubscribe, or `null` when triggers are not wired. */
  private unsubscribeConnectivity: (() => void) | null = null;

  constructor(options: SocketReconnectOptions) {
    this.policy = { ...DEFAULT_RETRY_POLICY, ...options.policy };
    this.ackWindowMs = options.ackWindowMs ?? DEFAULT_ACK_WINDOW_MS;
    this.scheduler = options.scheduler ?? defaultScheduler;
    this.connectivity = options.connectivity ?? connectivityStore;
  }

  /**
   * Wire the NetInfo/AppState reconnect triggers (R4.4) from the connectivity
   * bridge: a transition to online or to foreground/active requests a reconnect.
   */
  wireTriggers(): void {
    if (this.unsubscribeConnectivity) {
      this.unsubscribeConnectivity();
    }
    this.unsubscribeConnectivity = this.connectivity.subscribe((state, prev) => {
      const cameOnline = !prev.isOnline && state.isOnline;
      const cameForeground = prev.appState !== 'active' && state.appState === 'active';
      if (cameOnline || cameForeground) {
        this.requestReconnect();
      }
    });
  }

  /**
   * Request a fresh bounded connect-and-resubscribe cycle (R4.4). A no-op when
   * already connected-and-verified unless `force` is set (the manual trigger).
   */
  requestReconnect(force = false): void {
    if (this.disposed) {
      return;
    }
    if (!force && socket?.connected && !this.verifying && !this.cycleActive) {
      return;
    }
    this.clearTimers();
    this.attemptsMade = 0;
    this.beginAttempt();
  }

  /** Handle a transport `connect`: re-issue subscriptions, then verify (R4.4). */
  handleConnect(active: Socket): void {
    if (this.disposed) {
      return;
    }
    resubscribeAll(active);
    this.startVerification();
  }

  /** Count a `subscribed` ack and finish early once all rooms are acknowledged. */
  handleSubscribedAck(): void {
    if (this.disposed || !this.verifying) {
      return;
    }
    this.roomAcksReceived += 1;
    if (
      isResubscribeAcknowledged({
        trackedRooms: registry.trackedRooms().length,
        roomAcksReceived: this.roomAcksReceived,
      })
    ) {
      this.finishSuccess();
    }
  }

  /** Handle a transport `disconnect`: start a fresh cycle on unexpected loss (R4.4). */
  handleDisconnect(): void {
    if (this.disposed) {
      return;
    }
    if (this.suppressDisconnect) {
      this.suppressDisconnect = false;
      return;
    }
    this.clearTimers();
    this.verifying = false;
    this.attemptsMade = 0;
    this.beginAttempt();
  }

  /** Tear down: cancel timers and unwire triggers. */
  dispose(): void {
    this.disposed = true;
    this.clearTimers();
    if (this.unsubscribeConnectivity) {
      this.unsubscribeConnectivity();
      this.unsubscribeConnectivity = null;
    }
  }

  /** Begin a single connect-and-resubscribe attempt. */
  private beginAttempt(): void {
    if (this.disposed) {
      return;
    }
    this.cycleActive = true;
    this.clearTimers();
    const reconnecting = socket !== null;
    const active = ensureSocket();
    setManualReconnectAvailable(false);
    setSocketStatus(reconnecting ? 'reconnecting' : 'connecting');
    if (active.connected) {
      // Already connected (e.g. manual reconnect while up): verify directly.
      this.handleConnect(active);
    } else {
      this.suppressDisconnect = false;
      active.connect();
    }
  }

  /** Open the re-subscribe verification window after a (re)connect (R4.5). */
  private startVerification(): void {
    this.clearAckTimer();
    this.verifying = true;
    this.roomAcksReceived = 0;
    const trackedRooms = registry.trackedRooms().length;
    if (isResubscribeAcknowledged({ trackedRooms, roomAcksReceived: 0 })) {
      // No rooms to confirm (ticket-only or nothing tracked): success now.
      this.finishSuccess();
      return;
    }
    this.ackTimer = this.scheduler.set(() => this.onVerificationTimeout(), this.ackWindowMs);
  }

  /** Evaluate the verification window when it elapses (R4.5). */
  private onVerificationTimeout(): void {
    this.ackTimer = null;
    if (
      isResubscribeAcknowledged({
        trackedRooms: registry.trackedRooms().length,
        roomAcksReceived: this.roomAcksReceived,
      })
    ) {
      this.finishSuccess();
    } else {
      this.onResubscribeFailed();
    }
  }

  /** Settle a verified (re)connect as healthy (R4.5). */
  private finishSuccess(): void {
    this.clearTimers();
    this.verifying = false;
    this.cycleActive = false;
    this.attemptsMade = 0;
    setManualReconnectAvailable(false);
    setSocketStatus('connected');
  }

  /**
   * Treat the reconnection as failed (R4.5): drop the transport for a clean
   * retry, then either schedule the next attempt with exponential backoff or —
   * once attempts are exhausted — settle on `disconnected` and raise the
   * manual-reconnect affordance.
   */
  private onResubscribeFailed(): void {
    this.verifying = false;
    this.attemptsMade += 1;
    if (socket?.connected) {
      this.suppressDisconnect = true;
      socket.disconnect();
    }
    if (canRetry(this.attemptsMade, this.policy.maxAttempts)) {
      const delay = retryDelay(this.attemptsMade - 1, this.policy);
      setSocketStatus('reconnecting');
      this.retryTimer = this.scheduler.set(() => this.beginAttempt(), delay);
    } else {
      this.cycleActive = false;
      setSocketStatus('disconnected');
      setManualReconnectAvailable(true);
    }
  }

  /** Cancel the pending ack-window timer. */
  private clearAckTimer(): void {
    if (this.ackTimer !== null) {
      this.scheduler.clear(this.ackTimer);
      this.ackTimer = null;
    }
  }

  /** Cancel the pending backoff retry timer. */
  private clearRetryTimer(): void {
    if (this.retryTimer !== null) {
      this.scheduler.clear(this.retryTimer);
      this.retryTimer = null;
    }
  }

  /** Cancel both the ack-window and retry timers. */
  private clearTimers(): void {
    this.clearAckTimer();
    this.clearRetryTimer();
  }
}

/** The session-scoped reconnect controller, created lazily / via init. */
let reconnectController: ReconnectController | null = null;

/** Get (lazily create with defaults) the reconnect controller. */
function getReconnectController(): ReconnectController {
  if (!reconnectController) {
    reconnectController = new ReconnectController({});
  }
  return reconnectController;
}

/** Options for {@link initSocketReconnect}; all dependencies default sensibly. */
export interface SocketReconnectOptions {
  /** Override part or all of the backoff/bounds policy (R4.5). */
  policy?: Partial<RetryPolicy>;
  /** Re-subscribe acknowledgement window in ms (R4.5). */
  ackWindowMs?: number;
  /** Injectable timer scheduler (tests provide a fake). */
  scheduler?: Scheduler;
  /** Injectable connectivity source for the NetInfo/AppState triggers (R4.4). */
  connectivity?: ConnectivitySource;
}

/**
 * Initialize the reconnect controller and wire the NetInfo/AppState triggers
 * (R4.4). Call once at app boot (e.g. from the root layout) after
 * {@link initConnectivity}. Tests call it with injected sources/scheduler/policy
 * to drive the bounded retry deterministically. Returns a teardown function.
 *
 * @param options - injected dependencies / policy overrides.
 * @returns a function that disposes the controller and unwires its triggers.
 */
export function initSocketReconnect(options: SocketReconnectOptions = {}): () => void {
  if (reconnectController) {
    reconnectController.dispose();
  }
  reconnectController = new ReconnectController(options);
  reconnectController.wireTriggers();
  return () => {
    reconnectController?.dispose();
    reconnectController = null;
  };
}

/**
 * Attach the connection-status and event-bridge listeners to a freshly created
 * socket. Done once per connection (the socket is a session singleton). The
 * lifecycle listeners delegate to the {@link ReconnectController} so the bounded
 * connect-and-resubscribe retry owns status transitions and re-subscription.
 */
function attachListeners(active: Socket): void {
  // `connect` fires on the initial connection AND every reconnection; the
  // controller re-issues subscriptions (R4.4) and opens the verification
  // window (R4.5).
  active.on('connect', () => {
    getReconnectController().handleConnect(active);
  });

  // Transport loss is a reconnect trigger (R4.4): the controller starts a fresh
  // bounded cycle unless the disconnect was an intentional teardown.
  active.on('disconnect', () => {
    getReconnectController().handleDisconnect();
  });

  // Room subscription acknowledgement drives re-subscribe verification (R4.5).
  active.on(WS_EVENTS.SUBSCRIBED, () => {
    getReconnectController().handleSubscribedAck();
  });

  // Event bridge → TanStack Query invalidation (R3.3). No parallel store.
  active.on(WS_EVENTS.TICKET_UPDATE, (payload: IQueueUpdateEvent) => {
    handleTicketUpdate(payload);
  });

  // Notification subscription point for the Notification_Manager (task 6.1).
  active.on(WS_EVENTS.TICKET_NOTIFICATION, (payload: TicketNotificationPayload) => {
    handleTicketNotification(payload);
  });
}

/**
 * Ensure the session socket exists and is connecting/connected, creating it
 * lazily on first call. The customer app connects PUBLICLY (token-less).
 *
 * socket.io's own auto-reconnect is DISABLED: the {@link ReconnectController}
 * owns the bounded connect-and-resubscribe retry + re-subscribe verification
 * (R4.5), so there is exactly one reconnection authority.
 *
 * @returns the session socket.
 */
export function ensureSocket(): Socket {
  if (socket) {
    return socket;
  }

  // Ensure a controller exists before listeners can fire on connect.
  getReconnectController();
  setSocketStatus('connecting');

  socket = io(`${env.EXPO_PUBLIC_WS_URL}${QUEUE_NAMESPACE}`, {
    // Disable built-in reconnection; the ReconnectController drives the bounded
    // connect-and-resubscribe retry with backoff + verification (R4.5).
    reconnection: false,
    transports: ['websocket'],
  });

  attachListeners(socket);

  return socket;
}

/** Return the session socket if it has been created, otherwise `null`. */
export function getSocket(): Socket | null {
  return socket;
}

/**
 * Subscribe to a ticket's live updates (R4.1). Ref-counted: the first
 * subscriber emits exactly one `subscribe:ticket`; later subscribers just
 * increment the count. The socket is created lazily if needed; if it is not yet
 * connected, the ticket is recorded and (re)subscribed on the next `connect`.
 *
 * @param ticketId - the ticket to track.
 * @param orgId - the organization the ticket belongs to (needed to build the
 *   query key invalidated by the `ticket:update` bridge, R3.3).
 */
export function subscribeTicket(ticketId: string, orgId: string): void {
  const active = ensureSocket();
  if (registry.addTicket(ticketId, orgId) === 'subscribe' && active.connected) {
    emitSubscribeTicket(active, ticketId);
  }
}

/**
 * Release a ticket subscription (R4.3). Ref-counted: only the last subscriber
 * drops it from the registry so it is no longer re-subscribed on reconnect.
 *
 * Note: the gateway exposes no `unsubscribe:ticket` event (none exists in
 * `WS_EVENTS`), so there is no wire emit here — dropping the registry entry is
 * what stops future re-subscription. The server-side room membership is
 * released when the socket disconnects.
 *
 * @param ticketId - the ticket to release.
 */
export function unsubscribeTicket(ticketId: string): void {
  registry.removeTicket(ticketId);
}

/**
 * Subscribe to an org/service room's queue updates (R4.2). Ref-counted: the
 * first subscriber emits exactly one `subscribe`; later subscribers increment
 * the count. The socket is created lazily; rooms added while disconnected are
 * (re)subscribed on the next `connect`.
 *
 * @param descriptor - the org (and optional service) room to join.
 */
export function subscribeRoom(descriptor: RoomSubscription): void {
  const active = ensureSocket();
  if (registry.addRoom(descriptor) === 'subscribe' && active.connected) {
    emitSubscribeRoom(active, descriptor);
  }
}

/**
 * Release a room subscription (R4.3). Ref-counted: only the last subscriber
 * emits exactly one `unsubscribe` and drops it from the registry.
 *
 * @param descriptor - the room to release.
 */
export function unsubscribeRoom(descriptor: RoomSubscription): void {
  if (registry.removeRoom(descriptor) === 'unsubscribe' && socket?.connected) {
    emitUnsubscribeRoom(socket, descriptor);
  }
}

/**
 * Register a listener for `ticket:notification` events (the subscription point
 * consumed by the Notification_Manager, task 6.1). Returns an unsubscribe
 * function; this module performs no notification logic itself.
 *
 * @param listener - invoked with each `ticket:notification` payload.
 * @returns a function that removes the listener.
 */
export function onTicketNotification(listener: TicketNotificationListener): () => void {
  notificationListeners.add(listener);
  return () => {
    notificationListeners.delete(listener);
  };
}

/**
 * Manual reconnect trigger (R4.4). The user-initiated affordance surfaced when
 * bounded retries are exhausted (R4.5). Resets the attempt count and forces a
 * fresh connect-and-resubscribe cycle through the controller.
 */
export function reconnectNow(): void {
  getReconnectController().requestReconnect(true);
}

/** Snapshot of the tracked rooms/tickets (diagnostics/tests). */
export function getTrackedSubscriptions(): {
  tickets: ReturnType<SubscriptionRegistry['trackedTickets']>;
  rooms: ReturnType<SubscriptionRegistry['trackedRooms']>;
} {
  return { tickets: registry.trackedTickets(), rooms: registry.trackedRooms() };
}

/**
 * Tear down the session connection and all bookkeeping. Primarily for tests and
 * full teardown; normal navigation relies on the ref-counted subscribe/
 * unsubscribe lifecycle.
 */
export function disconnectSocket(): void {
  if (socket) {
    socket.removeAllListeners();
    socket.io.removeAllListeners();
    socket.disconnect();
    socket = null;
  }
  reconnectController?.dispose();
  reconnectController = null;
  registry.clear();
  notificationListeners.clear();
  setManualReconnectAvailable(false);
  setSocketStatus('idle');
}
