/**
 * Persisted-notifications query hook (R5.7).
 *
 * {@link useNotifications} reads the signed-in customer's persisted
 * notification list from `GET /notifications` through the single shared
 * `apiClient` (authenticated — fails closed without a token, R6.5) on the
 * central `queryKeys.notifications()` key. The backend returns the paginated
 * body `{ notifications, total, limit, offset }`; the hook returns the entries
 * already ordered reverse-chronologically (R5.7) via the pure
 * {@link orderByMostRecent} helper, so the screen renders them directly.
 *
 * The query is DISABLED while signed-out: the account-scoped notification list
 * requires a session, and the screen shows an account prompt instead (R5.7
 * "WHERE the Customer is signed in"). Account-scoped query data is removed on
 * sign-out by the invalidation layer (R7.4).
 */
import { useMemo } from 'react';
import { useQuery, type UseQueryResult } from '@tanstack/react-query';

import { apiClient } from '@/lib/api/client';
import { queryKeys } from '@/lib/api/query-keys';
import { useAuthStore } from '@/lib/auth/auth-store';

import { orderByMostRecent } from './order-notifications';
import type { NotificationListItem, NotificationsListResponse } from './types';

/** The path for the persisted notifications list (R5.7). */
const NOTIFICATIONS_PATH = '/notifications';

/**
 * Query the signed-in customer's persisted notifications, ordered most-recent
 * first (R5.7). Enabled only while signed in.
 *
 * @returns The TanStack Query result; `data` is the reverse-chronological list.
 */
export function useNotifications(): UseQueryResult<NotificationListItem[]> {
  const isSignedIn = useAuthStore((state) => state.status === 'signed-in');

  return useQuery({
    queryKey: queryKeys.notifications(),
    enabled: isSignedIn,
    queryFn: async (): Promise<NotificationListItem[]> => {
      const { data } = await apiClient.get<NotificationsListResponse>(NOTIFICATIONS_PATH, {
        authenticated: true,
      });
      // Display reverse-chronologically regardless of backend ordering (R5.7).
      return orderByMostRecent(data.notifications);
    },
  });
}

/** The composed result the screen consumes from {@link useNotificationsList}. */
export interface UseNotificationsListResult {
  /** The reverse-chronological notifications, or `[]` while loading/signed-out. */
  notifications: NotificationListItem[];
  /** Whether the customer is signed in (gates the account prompt). */
  isSignedIn: boolean;
  /** True while the list is loading (only meaningful when signed in). */
  isLoading: boolean;
  /** True when the list failed to load. */
  isError: boolean;
  /** True when signed in with no notifications. */
  isEmpty: boolean;
  /** Refetch the list (wired to the error-state retry). */
  refetch: () => void;
}

/**
 * Compose {@link useNotifications} with the sign-in gate into the flags the
 * notifications screen needs (loading / error / empty / signed-out). Keeps the
 * screen declarative.
 */
export function useNotificationsList(): UseNotificationsListResult {
  const isSignedIn = useAuthStore((state) => state.status === 'signed-in');
  const query = useNotifications();

  const notifications = useMemo(() => query.data ?? [], [query.data]);

  return {
    notifications,
    isSignedIn,
    isLoading: isSignedIn && query.isPending,
    isError: query.isError,
    isEmpty: isSignedIn && !query.isPending && !query.isError && notifications.length === 0,
    refetch: (): void => {
      void query.refetch();
    },
  };
}
