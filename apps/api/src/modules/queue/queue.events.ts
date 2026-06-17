import { TicketStatus } from '@prisma/client';

/**
 * Discriminator for the different kinds of queue update broadcast to clients.
 */
export type QueueUpdateType =
  | 'TICKET_JOINED'
  | 'TICKET_CALLED'
  | 'TICKET_RECALLED'
  | 'TICKET_SKIPPED'
  | 'TICKET_COMPLETED';

/**
 * Minimal ticket projection included in a queue update event.
 * Only the fields relevant to subscribed clients are exposed.
 */
export interface QueueUpdateTicket {
  id: string;
  ticketNumber: string;
  serviceId: string;
  status?: TicketStatus;
  counterName?: string;
  recallCount?: number;
}

/**
 * Payload broadcast on the `queue:update` event.
 */
export interface QueueUpdatePayload {
  type: QueueUpdateType;
  ticket: QueueUpdateTicket;
}

/**
 * Payload broadcast on the `queue:ticket-called` event,
 * consumed by display screens and announcement systems.
 */
export interface TicketCalledPayload {
  ticketNumber: string;
  counterName: string;
  serviceName: string;
  isRecall?: boolean;
  recallCount?: number;
}

/**
 * Payload sent to a specific customer's device on the `ticket:notification` event.
 */
export interface TicketNotificationPayload {
  type: string;
  title: string;
  message: string;
  ticketNumber?: string;
}
