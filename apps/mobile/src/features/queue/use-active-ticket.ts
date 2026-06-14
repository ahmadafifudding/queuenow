/**
 * Active-ticket composition hook (R3, R4.1, R4.3, R9).
 *
 * {@link useActiveTicket} is the single place the tracking screen pulls from. It
 * composes:
 *
 *  - the REST query ({@link useTicketStatus}) — the source of truth (R3.2), kept
 *    live by the socket bridge's invalidation on `ticket:update` (R3.3);
 *  - the PURE {@link projectTicketStatus} projection (R3.1/R3.4/R3.5);
 *  - the realtime subscription lifecycle: `subscribeTicket` on mount,
 *    `unsubscribeTicket` on unmount (R4.1/R4.3);
 *  - turn-alert routing: each `ticket:notification` for THIS ticket is handed to
 *    the Notification_Manager (R5) via the socket's notification seam;
 *  - the offline cache (R9.1/R9.2): every successful load is written to the
 *    read-only `activeTicketCache`, and while offline the cached ticket is shown
 *    with a staleness flag;
 *  - connectivity gating (R9.5) + a connectivity-restore refetch (R9.3) and a
 *    manual refresh (R9.4).
 *
 * Boundaries (REST client, socket seams, notification manager, cache) are
 * injectable via {@link UseActiveTicketDeps} so the composition can be tested
 * without a live backend, socket, or device storage.
 */
import { useCallback, useEffect, useRef, useState } from 'react';

import type { ApiClient } from '@/lib/api/client';
import {
  activeTicketCache as defaultActiveTicketCache,
  type ActiveTicketCache,
} from '@/lib/api/persist';
import { useConnectivity } from '@/lib/connectivity';
import {
  notificationManager as defaultNotificationManager,
  toTicketNotificationEvent,
  type NotificationManager,
} from '@/lib/notifications/manager';
import {
  onTicketNotification as socketOnTicketNotification,
  subscribeTicket as defaultSubscribeTicket,
  unsubscribeTicket as defaultUnsubscribeTicket,
  type TicketNotificationListener,
} from '@/lib/socket';
import type { TicketStatusView } from '@/lib/view-models';

import { projectTicketStatus, type ProjectedTicketStatus } from './project-ticket-status';
import { useTicketStatus } from './use-ticket-status';

/** Injectable boundaries for {@link useActiveTicket}; all optional with real defaults. */
export interface UseActiveTicketDeps {
  /** REST client passed through to {@link useTicketStatus}. */
  apiClient?: ApiClient;
  /** Subscribe-to-ticket seam (R4.1). Defaults to the shared socket client. */
  subscribeTicket?: (ticketId: string, orgId: string) => void;
  /** Unsubscribe-from-ticket seam (R4.3). Defaults to the shared socket client. */
  unsubscribeTicket?: (ticketId: string) => void;
  /** `ticket:notification` subscription seam. Defaults to the shared socket client. */
  onTicketNotification?: (listener: TicketNotificationListener) => () => void;
  /** Notification_Manager that surfaces turn alerts (R5). Defaults to the shared one. */
  notificationManager?: NotificationManager;
  /** Read-only offline cache (R9.1/R9.2). Defaults to the shared `activeTicketCache`. */
  cache?: ActiveTicketCache;
}

/** The composed result the tracking screen renders from. */
export interface UseActiveTicketResult {
  /** The gated, render-ready status view, or `null` before any data is available. */
  projected: ProjectedTicketStatus | null;
  /** True while the first load is in flight and no cached ticket is available yet. */
  isLoading: boolean;
  /** True when the REST load failed and no cached ticket is available to fall back to. */
  isError: boolean;
  /** The backend error `code` to map to copy, when {@link isError}. */
  errorCode: string | undefined;
  /** True when the shown data is the offline cache and may be out of date (R9.2). */
  isStale: boolean;
  /** True while a manual / restore refetch is running (drives pull-to-refresh). */
  isRefreshing: boolean;
  /** Whether live actions are disabled because the device is offline (R9.5). */
  liveActionsDisabled: boolean;
  /** The reason a live action is unavailable, or `null` when enabled (R9.5). */
  liveActionDisabledReason: string | null;
  /** Manual refresh (pull-to-refresh) — refetches the ticket via REST (R9.4). */
  refresh: () => void;
  /**
   * True once the customer has left the queue via a successful cancellation
   * (R11.3): the screen shows the "no longer in queue" view and live tracking has
   * been stopped.
   */
  hasLeft: boolean;
  /**
   * Stop live tracking for this ticket (R11.3): unsubscribes from realtime
   * updates and flips {@link UseActiveTicketResult.hasLeft} so the subscription is
   * not re-established. Called after a successful leave/cancel.
   */
  stopTracking: () => void;
}

/** Best-effort extraction of a backend error `code` from an unknown thrown value. */
function extractErrorCode(error: unknown): string | undefined {
  if (typeof error === 'object' && error !== null && 'code' in error) {
    const code = (error as { code: unknown }).code;
    if (typeof code === 'string' && code.length > 0) {
      return code;
    }
  }
  return undefined;
}

/**
 * Compose the live + offline state for one Active_Ticket (R3/R4/R9).
 *
 * @param orgId The organization the ticket belongs to.
 * @param ticketId The ticket to track.
 * @param deps Optional injected boundaries (for tests).
 * @returns The composed, render-ready active-ticket result.
 */
export function useActiveTicket(
  orgId: string,
  ticketId: string,
  deps: UseActiveTicketDeps = {},
): UseActiveTicketResult {
  const subscribe = deps.subscribeTicket ?? defaultSubscribeTicket;
  const unsubscribe = deps.unsubscribeTicket ?? defaultUnsubscribeTicket;
  const onNotification = deps.onTicketNotification ?? socketOnTicketNotification;
  const manager = deps.notificationManager ?? defaultNotificationManager;
  const cache = deps.cache ?? defaultActiveTicketCache;

  const connectivity = useConnectivity();
  const query = useTicketStatus(orgId, ticketId, { apiClient: deps.apiClient });

  // Last-known ticket from the read-only offline cache, used as the fallback the
  // screen renders while offline (R9.2) before/instead of fresh REST data.
  const [cachedTicket, setCachedTicket] = useState<TicketStatusView | null>(null);

  // Set once the customer leaves the queue via a successful cancellation (R11.3).
  // It both drives the "no longer in queue" view and stops the realtime
  // subscription below from being (re-)established.
  const [hasLeft, setHasLeft] = useState(false);

  // Seed the cached ticket once on mount so an offline cold start still renders
  // the last-known details (R9.2). Ignored if a fresh load wins the race.
  useEffect(() => {
    let active = true;
    void cache.read().then((record) => {
      if (active && record && record.orgId === orgId && record.ticket.id === ticketId) {
        setCachedTicket(record.ticket);
      }
    });
    return () => {
      active = false;
    };
  }, [cache, orgId, ticketId]);

  // Persist every successful load to the read-only cache (R9.1) and keep the
  // in-memory fallback in sync so it survives a later offline transition.
  useEffect(() => {
    if (query.data) {
      setCachedTicket(query.data);
      void cache.write(orgId, query.data);
    }
  }, [cache, orgId, query.data]);

  // Realtime subscription lifecycle (R4.1/R4.3) + turn-alert routing (R5). The
  // socket bridge already invalidates `queryKeys.ticket` on `ticket:update`, so
  // the query above refetches within 2s (R3.3); here we only manage the
  // subscription and forward this ticket's notifications to the manager. Once the
  // customer has left the queue (R11.3) the subscription is NOT (re-)established.
  useEffect(() => {
    if (hasLeft) {
      return;
    }
    subscribe(ticketId, orgId);
    const off = onNotification((payload) => {
      const event = toTicketNotificationEvent(payload);
      // Only surface alerts for THIS Active_Ticket (R5); ignore unrelated or
      // unrecognized payloads.
      if (!event || (event.ticketId && event.ticketId !== ticketId)) {
        return;
      }
      void manager.handleTicketNotification(event);
    });
    return () => {
      off();
      unsubscribe(ticketId);
    };
  }, [subscribe, unsubscribe, onNotification, manager, orgId, ticketId, hasLeft]);

  // Stop live tracking after a successful leave/cancel (R11.3): drop the realtime
  // subscription immediately and flip `hasLeft` so the effect above does not
  // re-subscribe and the screen can show the "no longer in queue" view.
  const stopTracking = useCallback(() => {
    unsubscribe(ticketId);
    setHasLeft(true);
  }, [unsubscribe, ticketId]);

  // Connectivity-restore refetch (R9.3): when the device comes back online,
  // refresh the ticket via REST. The socket layer re-subscribes on its own
  // (task 3.2). Tracks the previous online value to fire only on the transition.
  const wasOnline = useRef(connectivity.isOnline);
  useEffect(() => {
    if (!wasOnline.current && connectivity.isOnline) {
      void query.refetch();
    }
    wasOnline.current = connectivity.isOnline;
  }, [connectivity.isOnline, query]);

  const refresh = useCallback(() => {
    void query.refetch();
  }, [query]);

  // Prefer fresh REST data; fall back to the cached ticket while offline (R9.2).
  const displayTicket = query.data ?? cachedTicket;
  const projected = displayTicket ? projectTicketStatus(displayTicket) : null;

  return {
    projected,
    isLoading: query.isPending && cachedTicket === null,
    isError: query.isError && displayTicket === null,
    errorCode: query.isError ? extractErrorCode(query.error) : undefined,
    // Showing data while offline means it may be out of date (R9.2).
    isStale: connectivity.mayBeOutOfDate && displayTicket !== null,
    isRefreshing: query.isFetching && !query.isPending,
    liveActionsDisabled: connectivity.liveActionsDisabled,
    liveActionDisabledReason: connectivity.liveActionDisabledReason,
    refresh,
    hasLeft,
    stopTracking,
  };
}
