/**
 * Notifications feature barrel (R5.7).
 *
 * Exposes the PURE building blocks (`orderByMostRecent`,
 * `toNotificationDisplay`) used by the property/example tests, the
 * `useNotifications`/`useNotificationsList` query hooks, the `NotificationsList`
 * screen component delegated to from the thin `app/(account)/notifications`
 * route, and the feature view-model types.
 */
export { orderByMostRecent, type HasCreatedAt } from './order-notifications';
export { toNotificationDisplay } from './notification-display';
export {
  useNotifications,
  useNotificationsList,
  type UseNotificationsListResult,
} from './use-notifications';
export { NotificationsList } from './components/NotificationsList';
export type { NotificationDisplay, NotificationListItem, NotificationsListResponse } from './types';
