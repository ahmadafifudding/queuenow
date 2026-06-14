/*
 * Public surface of the ticket-tracking feature.
 *
 * The phone-facing page opened from the kiosk QR (`/track/:orgId/:ticketId`).
 */
export { TicketTracker, type TicketTrackerProps } from './components/TicketTracker';
export { useTicketStatus, isTerminalStatus } from './api/useTicketStatus';
export type { TrackedTicket, TrackedService, TrackedCounter } from './types';
