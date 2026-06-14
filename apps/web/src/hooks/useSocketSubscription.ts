/*
 * useSocketSubscription — bind a component's lifetime to a socket room (R3.5,
 * R3.10).
 *
 * On mount it ensures the session socket exists and emits `subscribe` for the
 * given room; on unmount it emits `unsubscribe`. Subscriptions are ref-counted
 * in `lib/socket.ts`, so multiple components subscribing to the same room share
 * one server-side subscription and the room is only released when the last
 * subscriber unmounts (design Property 11). Re-subscription on reconnect is
 * handled centrally by the Socket_Client (R3.7).
 */
import { useEffect } from 'react';

import { ensureSocket, subscribeRoom, unsubscribeRoom, type SocketMode } from '@/lib/socket';

/** Options controlling a single room subscription. */
export interface UseSocketSubscriptionOptions {
  /** The organization whose queue updates to subscribe to. */
  orgId: string;
  /** Optional service to scope the subscription to a single service room. */
  serviceId?: string;
  /**
   * Connection mode for the session socket. `'dashboard'` carries the access
   * token in the handshake; `'public'` (Display / Kiosk) connects token-less.
   * Only the first connection of the session fixes the mode. Defaults to
   * `'dashboard'`.
   */
  mode?: SocketMode;
  /**
   * When `false`, the hook performs no subscription (e.g. while `orgId` is not
   * yet known). Defaults to `true`.
   */
  enabled?: boolean;
}

/**
 * Subscribe to an org/service queue room for the lifetime of the calling
 * component.
 *
 * @param options - the room descriptor plus connection mode and enablement.
 */
export function useSocketSubscription(options: UseSocketSubscriptionOptions): void {
  const { orgId, serviceId, mode = 'dashboard', enabled = true } = options;

  useEffect(() => {
    if (!enabled || !orgId) {
      return;
    }

    ensureSocket(mode);
    subscribeRoom({ orgId, serviceId });

    return () => {
      unsubscribeRoom({ orgId, serviceId });
    };
  }, [orgId, serviceId, mode, enabled]);
}
