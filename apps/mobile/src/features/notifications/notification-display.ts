/**
 * Pure type-derived presentation for persisted notifications (R5.7, R5.6).
 *
 * Maps a {@link NotificationListItem} to a presentation-ready
 * {@link NotificationDisplay} using the shared {@link NotificationType} enum
 * (never matching on backend text) and the centralized i18n catalog. Keeping
 * this pure means the screen renders rows declaratively and the mapping is
 * independently testable.
 */
import { NotificationType } from '@queuenow/shared-types';

import { strings } from '@/i18n';

import type { NotificationDisplay, NotificationListItem } from './types';

/** Type-derived title copy for a notification (R5.6). */
function titleFor(type: NotificationType): string {
  switch (type) {
    case NotificationType.ALMOST_TURN:
      return strings.notifications.almostTurnTitle;
    case NotificationType.YOUR_TURN:
      return strings.notifications.yourTurnTitle;
    case NotificationType.SKIPPED:
      return strings.notifications.skippedTitle;
    default:
      // Unknown/future type → generic list title rather than leaking a raw code.
      return strings.notifications.listTitle;
  }
}

/** Type-derived body copy for a notification (R5.6). */
function bodyFor(type: NotificationType): string {
  switch (type) {
    case NotificationType.ALMOST_TURN:
      return strings.notifications.almostTurnBody;
    case NotificationType.YOUR_TURN:
      // The persisted list item carries no counter name, so use the generic
      // "proceed to the counter" body rather than an empty `{counter}` slot.
      return strings.notifications.yourTurnBodyNoCounter;
    case NotificationType.SKIPPED:
      return strings.notifications.skippedBody;
    default:
      return strings.common.empty;
  }
}

/** Summarize the related ticket/service for the row meta line, or `null`. */
function metaFor(item: NotificationListItem): string | null {
  if (!item.ticket) {
    return null;
  }
  const { ticketNumber, service } = item.ticket;
  return service ? `${ticketNumber} · ${service.name}` : ticketNumber;
}

/**
 * Project a {@link NotificationListItem} into a presentation-ready
 * {@link NotificationDisplay}. Pure and deterministic.
 *
 * @param item The persisted notification list item.
 * @returns The derived display row.
 */
export function toNotificationDisplay(item: NotificationListItem): NotificationDisplay {
  return {
    id: item.id,
    type: item.type,
    title: titleFor(item.type),
    body: bodyFor(item.type),
    meta: metaFor(item),
    createdAt: item.createdAt,
  };
}
