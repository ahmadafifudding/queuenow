/*
 * Realtime_Client — pure decision logic (Requirements 4.1, 4.2, 4.3, 4.6, 3.3).
 *
 * This module holds the *pure, socket-free* core of the realtime client so it
 * can be exercised by the property tests in tasks 3.3–3.6 without a live socket:
 *
 *  - `SubscriptionRegistry` — the ref-counted subscription bookkeeping for
 *    tracked tickets (`subscribe:ticket`) and org/service rooms (`subscribe`).
 *    Each `add*` returns whether this was the FIRST subscriber (→ the caller
 *    should emit exactly one wire `subscribe`/`subscribe:ticket`); each
 *    `remove*` returns whether that was the LAST subscriber (→ emit exactly one
 *    wire `unsubscribe`). The registry never touches a socket; `lib/socket.ts`
 *    owns the I/O and uses these return values to decide what to emit.
 *
 *  - `queueKeysForEvent` — maps an incoming `ticket:update` payload to the
 *    TanStack Query keys to invalidate, using the tracked tickets to recover the
 *    `orgId` the wire payload does not carry (the server scopes delivery by the
 *    `ticket:<ticketId>` room, so the payload has only `ticket.id`).
 *
 * Keeping these pure and deterministic also gives task 3.2 a stable seam to add
 * the bounded connect-and-resubscribe retry + backoff on top of, without having
 * to reimplement the subscription bookkeeping.
 */
import type { IQueueUpdateEvent } from '@queuenow/shared-types';
import type { QueryKey } from '@tanstack/react-query';

import { queryKeys } from '@/lib/api/query-keys';

/**
 * A tracked ticket subscription. `orgId` is kept alongside `ticketId` because
 * the `ticket:update` wire payload does not carry the org, but the query-key
 * factory (`queryKeys.ticket(orgId, ticketId)`) requires it (R3.3).
 */
export interface TrackedTicket {
  /** The ticket whose live updates are wanted (`subscribe:ticket`). */
  ticketId: string;
  /** The organization the ticket belongs to (needed to build the query key). */
  orgId: string;
}

/**
 * A tracked org/service room subscription. Omitting `serviceId` subscribes to
 * the whole org room; providing it scopes to a single service room. Mirrors the
 * gateway payload `{ orgId, serviceId? }`.
 */
export interface TrackedRoom {
  /** The organization whose queue updates are wanted. */
  orgId: string;
  /** Optional service to scope the subscription to a single service room. */
  serviceId?: string;
}

/**
 * Result of a ref-counted add: `'subscribe'` when this was the first subscriber
 * for the entry (the caller must emit exactly one wire subscribe), otherwise
 * `'noop'` (the count was merely incremented).
 */
export type AddResult = 'subscribe' | 'noop';

/**
 * Result of a ref-counted remove: `'unsubscribe'` when that was the last
 * subscriber for the entry (the caller must emit exactly one wire unsubscribe
 * and the entry is dropped), otherwise `'noop'`.
 */
export type RemoveResult = 'unsubscribe' | 'noop';

/** Stable de-dupe key for a tracked ticket. */
export function ticketKey(ticketId: string): string {
  return ticketId;
}

/** Stable de-dupe key for a tracked room (org + optional service). */
export function roomKey(room: TrackedRoom): string {
  return `${room.orgId}::${room.serviceId ?? ''}`;
}

/** Internal ref-counted cell. */
interface Counted<T> {
  entry: T;
  count: number;
}

/**
 * Ref-counted subscription registry for tickets and rooms.
 *
 * Invariants (design Property "subscription lifecycle"):
 *  - The set of tracked entries equals the entries with at least one mounted
 *    subscriber.
 *  - `add*` returns `'subscribe'` exactly once per entry (the 0→1 transition);
 *    `remove*` returns `'unsubscribe'` exactly once per entry (the 1→0
 *    transition) and then drops the entry.
 *  - Counts never go negative; removing an untracked entry is a `'noop'`.
 *
 * The registry is intentionally socket-free so it can be unit/property tested in
 * isolation; `lib/socket.ts` holds the singleton instance and performs the I/O.
 */
export class SubscriptionRegistry {
  private readonly tickets = new Map<string, Counted<TrackedTicket>>();
  private readonly rooms = new Map<string, Counted<TrackedRoom>>();

  /**
   * Add (or increment) a ticket subscription.
   *
   * @returns `'subscribe'` if this is the first subscriber for the ticket
   * (emit `subscribe:ticket`), otherwise `'noop'`.
   */
  addTicket(ticketId: string, orgId: string): AddResult {
    const key = ticketKey(ticketId);
    const existing = this.tickets.get(key);
    if (existing) {
      existing.count += 1;
      return 'noop';
    }
    this.tickets.set(key, { entry: { ticketId, orgId }, count: 1 });
    return 'subscribe';
  }

  /**
   * Release (or decrement) a ticket subscription.
   *
   * @returns `'unsubscribe'` if this was the last subscriber (the entry is
   * dropped), otherwise `'noop'`. Note: the gateway exposes no
   * `unsubscribe:ticket` event, so the caller stops tracking the ticket for
   * reconnect re-subscription rather than emitting a wire event (see socket.ts).
   */
  removeTicket(ticketId: string): RemoveResult {
    const key = ticketKey(ticketId);
    const existing = this.tickets.get(key);
    if (!existing) {
      return 'noop';
    }
    existing.count -= 1;
    if (existing.count > 0) {
      return 'noop';
    }
    this.tickets.delete(key);
    return 'unsubscribe';
  }

  /**
   * Add (or increment) a room subscription.
   *
   * @returns `'subscribe'` if this is the first subscriber for the room
   * (emit `subscribe`), otherwise `'noop'`.
   */
  addRoom(room: TrackedRoom): AddResult {
    const key = roomKey(room);
    const existing = this.rooms.get(key);
    if (existing) {
      existing.count += 1;
      return 'noop';
    }
    this.rooms.set(key, { entry: { orgId: room.orgId, serviceId: room.serviceId }, count: 1 });
    return 'subscribe';
  }

  /**
   * Release (or decrement) a room subscription.
   *
   * @returns `'unsubscribe'` if this was the last subscriber (the entry is
   * dropped, emit `unsubscribe`), otherwise `'noop'`.
   */
  removeRoom(room: TrackedRoom): RemoveResult {
    const key = roomKey(room);
    const existing = this.rooms.get(key);
    if (!existing) {
      return 'noop';
    }
    existing.count -= 1;
    if (existing.count > 0) {
      return 'noop';
    }
    this.rooms.delete(key);
    return 'unsubscribe';
  }

  /** Snapshot of the currently-tracked tickets (for reconnect re-subscribe / tests). */
  trackedTickets(): TrackedTicket[] {
    return Array.from(this.tickets.values(), (c) => c.entry);
  }

  /** Snapshot of the currently-tracked rooms (for reconnect re-subscribe / tests). */
  trackedRooms(): TrackedRoom[] {
    return Array.from(this.rooms.values(), (c) => c.entry);
  }

  /** Current ref-count for a ticket (0 when untracked). Diagnostics/tests. */
  ticketCount(ticketId: string): number {
    return this.tickets.get(ticketKey(ticketId))?.count ?? 0;
  }

  /** Current ref-count for a room (0 when untracked). Diagnostics/tests. */
  roomCount(room: TrackedRoom): number {
    return this.rooms.get(roomKey(room))?.count ?? 0;
  }

  /** Drop all tracked entries (full teardown / tests). */
  clear(): void {
    this.tickets.clear();
    this.rooms.clear();
  }
}

/**
 * Compute the TanStack Query keys to invalidate for an incoming `ticket:update`
 * event (R3.3). The wire payload carries only `ticket.id` (delivery is scoped by
 * the `ticket:<ticketId>` room), so the tracked tickets supply the `orgId`
 * needed to build `queryKeys.ticket(orgId, ticketId)`.
 *
 * Pure and deterministic: returns one de-duplicated key for every tracked ticket
 * whose `ticketId` matches the event's `ticket.id`. Unknown/untracked tickets
 * yield no keys (the app is not tracking them, so nothing to refresh). Exported
 * for the socket-bridge property test (tasks 3.3–3.6).
 *
 * @param event - the `ticket:update` payload (`IQueueUpdateEvent`).
 * @param tracked - the currently-tracked ticket subscriptions.
 * @returns the de-duplicated query keys to invalidate (possibly empty).
 */
export function queueKeysForEvent(
  event: IQueueUpdateEvent,
  tracked: readonly TrackedTicket[],
): QueryKey[] {
  const eventTicketId = event.ticket?.id;
  if (!eventTicketId) {
    return [];
  }
  const keys = new Map<string, QueryKey>();
  for (const t of tracked) {
    if (t.ticketId !== eventTicketId) {
      continue;
    }
    keys.set(ticketKey(t.ticketId), queryKeys.ticket(t.orgId, t.ticketId));
  }
  return Array.from(keys.values());
}

/*
 * Bounded connect-and-resubscribe retry — PURE schedule + decisions (R4.5).
 *
 * These helpers are the socket-free core of task 3.2's resilience layer. They
 * are kept here, alongside the pure subscription registry, so the retry/backoff
 * property test (Property 9, task 3.6) can exercise the schedule and the
 * bounded-attempts decision deterministically without a live socket or timers.
 * `lib/socket.ts` owns the I/O (timers, connect, ack listening) and composes
 * these pure functions to drive its retry loop.
 */

/**
 * Tunable schedule for the bounded connect-and-resubscribe retry (R4.5).
 *
 * - `base` — initial backoff delay (ms) used for the first retry.
 * - `factor` — exponential multiplier applied per subsequent attempt.
 * - `cap` — maximum backoff delay (ms); the schedule is clamped to this.
 * - `maxAttempts` — the bound on retries; once reached the client settles on
 *   `disconnected` and surfaces the manual-reconnect affordance.
 */
export interface RetryPolicy {
  /** Initial backoff delay (ms) for the first retry (attempt index 0). */
  base: number;
  /** Exponential multiplier applied per attempt. */
  factor: number;
  /** Maximum backoff delay (ms); the schedule is clamped to this. */
  cap: number;
  /** Bound on retries before settling on `disconnected`. */
  maxAttempts: number;
}

/**
 * Default retry policy (design "Realtime Client": base 500 ms, factor 2,
 * cap 30 s, bounded attempts). Overridable via {@link RetryPolicy} for testing.
 */
export const DEFAULT_RETRY_POLICY: RetryPolicy = {
  base: 500,
  factor: 2,
  cap: 30_000,
  maxAttempts: 6,
};

/**
 * Pure exponential-backoff schedule (R4.5): `delay = min(base * factor^attempt, cap)`.
 *
 * `attempt` is the 0-based retry index (0 → `base`, 1 → `base * factor`, …).
 * Negative or fractional inputs are floored at 0; a non-finite intermediate
 * (numeric overflow) clamps to `cap`. The result is always a finite,
 * non-negative number that never exceeds `cap` — the invariants Property 9
 * (task 3.6) asserts across all inputs.
 *
 * @param attempt - 0-based retry index.
 * @param options - the `base`/`factor`/`cap` portion of a {@link RetryPolicy}.
 * @returns the backoff delay in milliseconds, clamped to `[0, cap]`.
 */
export function retryDelay(
  attempt: number,
  options: Pick<RetryPolicy, 'base' | 'factor' | 'cap'>,
): number {
  const safeAttempt = Number.isFinite(attempt) ? Math.max(0, Math.floor(attempt)) : 0;
  const raw = options.base * options.factor ** safeAttempt;
  if (!Number.isFinite(raw)) {
    return options.cap;
  }
  return Math.min(Math.max(0, raw), options.cap);
}

/**
 * Pure bounded-attempts decision (R4.5): whether another retry is permitted
 * after `attemptsMade` failed connect-and-resubscribe cycles, given the bound
 * `maxAttempts`. Returns `false` once attempts are exhausted, so the caller
 * settles status on `disconnected` and surfaces the manual-reconnect affordance.
 *
 * @param attemptsMade - count of connect-and-resubscribe cycles already failed.
 * @param maxAttempts - the policy bound on retries.
 * @returns `true` iff a further retry is within bounds.
 */
export function canRetry(attemptsMade: number, maxAttempts: number): boolean {
  return attemptsMade < maxAttempts;
}

/**
 * Pure re-subscribe verification decision (R4.5). After a (re)connect the client
 * re-emits every tracked subscription and waits a short window for
 * acknowledgement, then calls this to decide whether the reconnection's
 * resubscription succeeded.
 *
 * Room subscriptions are confirmed by the gateway's `subscribed` ack (one per
 * `subscribe`). Ticket subscriptions receive NO server ack (the gateway emits
 * none for `subscribe:ticket`), so they count as acknowledged once emitted on a
 * connected socket. The reconnection's resubscription is therefore considered
 * acknowledged iff every tracked room has been acked; with no tracked rooms the
 * (re)connect is trivially acknowledged and need not wait out the window.
 *
 * @param args.trackedRooms - number of currently-tracked room subscriptions.
 * @param args.roomAcksReceived - `subscribed` acks observed in the window.
 * @returns `true` iff resubscription is considered acknowledged.
 */
export function isResubscribeAcknowledged(args: {
  trackedRooms: number;
  roomAcksReceived: number;
}): boolean {
  if (args.trackedRooms <= 0) {
    return true;
  }
  return args.roomAcksReceived >= args.trackedRooms;
}
