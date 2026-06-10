import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  OnGatewayInit,
  OnGatewayConnection,
  OnGatewayDisconnect,
  MessageBody,
  ConnectedSocket,
} from '@nestjs/websockets';
import { Logger } from '@nestjs/common';
import { Server, Socket } from 'socket.io';
import {
  QueueUpdatePayload,
  TicketCalledPayload,
  TicketNotificationPayload,
} from './queue.events';

@WebSocketGateway({
  cors: {
    origin: '*',
  },
  namespace: '/queue',
})
export class QueueGateway
  implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect
{
  @WebSocketServer()
  server!: Server;

  private readonly logger = new Logger(QueueGateway.name);

  afterInit(): void {
    this.logger.log('Queue WebSocket Gateway initialized');
  }

  handleConnection(client: Socket): void {
    this.logger.log(`Client connected: ${client.id}`);
  }

  handleDisconnect(client: Socket): void {
    this.logger.log(`Client disconnected: ${client.id}`);
  }

  /**
   * Client subscribes to a specific organization's queue updates
   */
  @SubscribeMessage('subscribe')
  handleSubscribe(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { orgId: string; serviceId?: string },
  ): void {
    const room = data.serviceId
      ? `org:${data.orgId}:service:${data.serviceId}`
      : `org:${data.orgId}`;

    client.join(room);
    this.logger.log(`Client ${client.id} joined room: ${room}`);

    client.emit('subscribed', { room, message: 'Successfully subscribed to queue updates' });
  }

  /**
   * Client unsubscribes from queue updates
   */
  @SubscribeMessage('unsubscribe')
  handleUnsubscribe(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { orgId: string; serviceId?: string },
  ): void {
    const room = data.serviceId
      ? `org:${data.orgId}:service:${data.serviceId}`
      : `org:${data.orgId}`;

    client.leave(room);
    this.logger.log(`Client ${client.id} left room: ${room}`);
  }

  /**
   * Client subscribes to a specific ticket's updates
   */
  @SubscribeMessage('subscribe:ticket')
  handleSubscribeTicket(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { ticketId: string },
  ): void {
    const room = `ticket:${data.ticketId}`;
    client.join(room);
    this.logger.log(`Client ${client.id} subscribed to ticket: ${data.ticketId}`);
  }

  /**
   * Emit queue update to all subscribers of an organization
   */
  emitQueueUpdate(orgId: string, payload: QueueUpdatePayload): void {
    this.server.to(`org:${orgId}`).emit('queue:update', payload);

    // Also emit to service-specific room if serviceId is available
    if (payload.ticket?.serviceId) {
      this.server
        .to(`org:${orgId}:service:${payload.ticket.serviceId}`)
        .emit('queue:update', payload);
    }

    // Emit to ticket-specific room
    if (payload.ticket?.id) {
      this.server.to(`ticket:${payload.ticket.id}`).emit('ticket:update', payload);
    }
  }

  /**
   * Emit ticket called event - used for display screens and announcements
   */
  emitTicketCalled(orgId: string, payload: TicketCalledPayload): void {
    this.server.to(`org:${orgId}`).emit('queue:ticket-called', payload);
  }

  /**
   * Emit notification to a specific ticket subscriber (customer's device)
   */
  emitTicketNotification(ticketId: string, payload: TicketNotificationPayload): void {
    this.server.to(`ticket:${ticketId}`).emit('ticket:notification', payload);
  }
}
