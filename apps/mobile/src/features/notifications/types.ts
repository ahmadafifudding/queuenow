/**
 * Notifications feature view-model types (R5.7).
 *
 * The persisted notification list is read from `GET /notifications`, which
 * returns the standard success envelope wrapping a paginated body:
 * `{ notifications, total, limit, offset }`. Each entry is a
 * {@link NotificationListItem}, a COMPOSITION over the shared
 * {@link NotificationType} enum — the app never redefines the notification
 * type (R10.5, R14.5). The list-item shape mirrors the design's
 * `NotificationListItem` data model.
 */
import type { NotificationType } from '@queuenow/shared-types';

/**
 * A single persisted notification as returned by `GET /notifications`.
 *
 * `type` is the shared {@link NotificationType}; `status` is the backend's
 * delivery/read status (kept as an opaque string — the app does not enumerate
 * it). `createdAt` is an ISO-8601 timestamp used for reverse-chronological
 * ordering (R5.7). `ticket` is present when the notification is tied to a
 * specific ticket.
 */
export interface NotificationListItem {
  /** Unique notification id. */
  id: string;
  /** The notification type (shared enum). */
  type: NotificationType;
  /** Backend delivery/read status, treated as opaque. */
  status: string;
  /** ISO-8601 creation timestamp; drives reverse-chronological ordering. */
  createdAt: string;
  /** The ticket this notification refers to, when applicable. */
  ticket?: {
    id: string;
    ticketNumber: string;
    orgId: string;
    service?: { id: string; name: string };
  };
}

/**
 * The paginated body returned (inside the success envelope's `data`) by
 * `GET /notifications`.
 */
export interface NotificationsListResponse {
  /** The notifications for this page. */
  notifications: NotificationListItem[];
  /** Total number of notifications available. */
  total: number;
  /** The page size requested. */
  limit: number;
  /** The page offset requested. */
  offset: number;
}

/**
 * A presentation-ready notification row derived purely from a
 * {@link NotificationListItem}. Title/body are type-derived from the i18n
 * catalog; `meta` summarizes the related ticket/service when present.
 */
export interface NotificationDisplay {
  /** The originating notification id (stable list key). */
  id: string;
  /** The notification type (drives any type-specific UI affordance). */
  type: NotificationType;
  /** Type-derived headline copy. */
  title: string;
  /** Type-derived supporting copy. */
  body: string;
  /** Optional ticket/service summary line, or `null` when no ticket is attached. */
  meta: string | null;
  /** The original ISO-8601 creation timestamp. */
  createdAt: string;
}
