/*
 * Builds the phone-tracking URL that the Kiosk encodes into the QR code (R12.5).
 *
 * ASSUMPTION (documented): the MVP delivery is phone-based — there is no
 * on-site printer. A customer scans the QR to open a tracking page for their
 * ticket. The backend exposes the public ticket-status read at
 * `GET /organizations/:orgId/queue/ticket/:ticketId`, which needs BOTH the org
 * and the ticket id; we therefore encode both into a customer-facing tracking
 * route `"/track/:orgId/:ticketId"` served from the same origin as the Kiosk
 * (or by the customer mobile app at that deep link). The exact tracking-page
 * implementation lives outside `apps/web`; this module only commits to the URL
 * SHAPE so the QR is stable and meaningful. If the tracking route changes,
 * update this single function.
 */

/**
 * Build the absolute tracking URL for a ticket, suitable for a QR code (R12.5).
 *
 * @param orgId - the organization the ticket belongs to.
 * @param ticketId - the issued ticket id.
 * @param origin - the origin to root the URL at; defaults to the current
 *   `window.location.origin`. Injectable so the function stays pure and
 *   testable without a DOM.
 * @returns an absolute URL string (e.g. `https://host/track/<orgId>/<ticketId>`).
 */
export function buildTrackingUrl(
  orgId: string,
  ticketId: string,
  origin: string = typeof window !== 'undefined' ? window.location.origin : '',
): string {
  const root = origin.replace(/\/+$/, '');
  return `${root}/track/${encodeURIComponent(orgId)}/${encodeURIComponent(ticketId)}`;
}
