/**
 * Strongly-typed payloads emitted over the /queue WebSocket namespace.
 * Keeping these in one place avoids `any` in the gateway/service and makes
 * the real-time contract explicit for frontend consumers.
 */

export type QueueUpdateType =
  | 'TICKET_JOINED'
  | 'TICKET_CALLED'
  | 'TICKET_RECALLED'
  | 'TICKET_SKIPPED'
  | 'TICKET_COMPLETED'
  | 'TICKET_REJOINED';

export interface QueueUpdateTicket {
  id?: string;
  ticketNumber: string;
  status?: string;
  serviceId?: string;
  counterName?: string;
  recallCount?: number;
  position?: number;
}

/** Emitted on `queue:update` to org/service subscribers (staff dashboards). */
export interface QueueUpdatePayload {
  type: QueueUpdateType;
  ticket: QueueUpdateTicket;
}

/** Emitted on `queue:ticket-called` to staff + public display boards. */
export interface TicketCalledPayload {
  ticketNumber: string;
  counterName: string;
  serviceName: string;
  isRecall?: boolean;
  recallCount?: number;
}

/** Emitted on `ticket:notification` to a specific ticket room (customer device). */
export interface TicketNotificationPayload {
  type?: string;
  message?: string;
  [key: string]: unknown;
}
