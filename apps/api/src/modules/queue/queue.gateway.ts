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
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { Server, Socket } from 'socket.io';
import { PrismaService } from '../../prisma/prisma.service';
import type {
  QueueUpdatePayload,
  TicketCalledPayload,
  TicketNotificationPayload,
} from './queue.events';

/** Role inferred from the JWT presented during the WebSocket handshake. */
type SocketRole = 'staff' | 'customer' | 'anonymous';

interface SocketUser {
  /** User id (staff), customer profile id, or the socket id for anonymous clients. */
  id: string;
  role: SocketRole;
  /** Present for staff only. */
  orgId?: string;
  /** OWNER | ADMIN | STAFF — present for staff only. */
  staffRole?: string;
}

interface JwtPayload {
  sub: string;
  type?: string;
  orgId?: string;
  role?: string;
}

/**
 * Allowed browser origins. In production set CORS_ORIGINS (comma-separated).
 * When unset (local dev) we reflect the request origin so dev tooling works,
 * but a configured deployment is always locked down to the listed origins.
 */
const allowedOrigins = (process.env.CORS_ORIGINS ?? '')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

@WebSocketGateway({
  namespace: '/queue',
  cors: {
    origin: allowedOrigins.length > 0 ? allowedOrigins : true,
    credentials: true,
  },
})
export class QueueGateway
  implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect
{
  @WebSocketServer()
  server!: Server;

  private readonly logger = new Logger(QueueGateway.name);

  constructor(
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly prisma: PrismaService,
  ) {}

  afterInit(): void {
    this.logger.log('Queue WebSocket Gateway initialized');
  }

  /**
   * Authenticate at the handshake.
   * - No token        -> anonymous client (limited to public display + ticket tracking).
   * - Valid token     -> staff or customer identity attached to the socket.
   * - Invalid/expired -> connection rejected.
   */
  handleConnection(client: Socket): void {
    try {
      const user = this.authenticate(client);
      client.data.user = user;
      this.logger.log(`Client connected: ${client.id} (role: ${user.role})`);
    } catch {
      this.logger.warn(`Rejected connection ${client.id}: invalid token`);
      client.emit('error', { message: 'Unauthorized: invalid or expired token' });
      client.disconnect(true);
    }
  }

  handleDisconnect(client: Socket): void {
    this.logger.log(`Client disconnected: ${client.id}`);
  }

  /**
   * Subscribe to an organization's full queue updates (staff dashboards).
   * Restricted to staff and only for their own organization.
   */
  @SubscribeMessage('subscribe')
  handleSubscribe(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { orgId: string; serviceId?: string },
  ): void {
    const user = this.getUser(client);

    if (!data?.orgId) {
      this.emitError(client, 'orgId is required');
      return;
    }

    if (user.role !== 'staff') {
      this.emitError(
        client,
        'Forbidden: staff authentication is required for queue updates',
      );
      return;
    }

    if (user.orgId !== data.orgId) {
      this.emitError(
        client,
        'Forbidden: cannot subscribe to another organization',
      );
      return;
    }

    const room = data.serviceId
      ? `org:${data.orgId}:service:${data.serviceId}`
      : `org:${data.orgId}`;

    client.join(room);
    this.logger.log(`Staff ${user.id} joined room: ${room}`);

    client.emit('subscribed', {
      room,
      message: 'Successfully subscribed to queue updates',
    });
  }

  /**
   * Public "now serving" display board.
   * Open to anyone (lobby screens often run without a login) but only ever
   * receives `queue:ticket-called` events — never the full operational stream.
   */
  @SubscribeMessage('subscribe:display')
  handleSubscribeDisplay(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { orgId: string },
  ): void {
    if (!data?.orgId) {
      this.emitError(client, 'orgId is required');
      return;
    }

    const room = `org:${data.orgId}:display`;
    client.join(room);
    this.logger.log(`Client ${client.id} joined display board: ${room}`);

    client.emit('subscribed', {
      room,
      message: 'Successfully subscribed to display board',
    });
  }

  /**
   * Unsubscribe from an organization's queue updates.
   */
  @SubscribeMessage('unsubscribe')
  handleUnsubscribe(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { orgId: string; serviceId?: string },
  ): void {
    if (!data?.orgId) {
      this.emitError(client, 'orgId is required');
      return;
    }

    const room = data.serviceId
      ? `org:${data.orgId}:service:${data.serviceId}`
      : `org:${data.orgId}`;

    client.leave(room);
    client.leave(`org:${data.orgId}:display`);
    this.logger.log(`Client ${client.id} left room: ${room}`);
  }

  /**
   * Subscribe to a single ticket's updates (customer tracking).
   *
   * Capability model: a ticket id is an unguessable UUID handed to whoever
   * joined the queue, so possessing it authorizes tracking that ticket. We
   * still enforce that:
   *  - the ticket exists,
   *  - staff may only track tickets within their own organization,
   *  - a logged-in customer may only track tickets they own.
   * Anonymous walk-ins (the common QR flow) are allowed via the capability.
   */
  @SubscribeMessage('subscribe:ticket')
  async handleSubscribeTicket(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { ticketId: string },
  ): Promise<void> {
    const user = this.getUser(client);

    if (!data?.ticketId) {
      this.emitError(client, 'ticketId is required');
      return;
    }

    const ticket = await this.prisma.queueTicket.findUnique({
      where: { id: data.ticketId },
      select: { id: true, orgId: true, customerProfileId: true },
    });

    if (!ticket) {
      this.emitError(client, 'Ticket not found');
      return;
    }

    if (user.role === 'staff' && user.orgId !== ticket.orgId) {
      this.emitError(
        client,
        'Forbidden: ticket belongs to another organization',
      );
      return;
    }

    if (
      user.role === 'customer' &&
      ticket.customerProfileId &&
      ticket.customerProfileId !== user.id
    ) {
      this.emitError(client, 'Forbidden: this ticket belongs to another customer');
      return;
    }

    const room = `ticket:${data.ticketId}`;
    client.join(room);
    this.logger.log(`Client ${client.id} subscribed to ticket: ${data.ticketId}`);

    client.emit('subscribed', {
      room,
      message: 'Successfully subscribed to ticket updates',
    });
  }

  // ─── Emit methods (called from QueueService) ──────────────────────────

  /**
   * Emit a queue update to staff subscribers of an organization.
   */
  emitQueueUpdate(orgId: string, payload: QueueUpdatePayload): void {
    this.server.to(`org:${orgId}`).emit('queue:update', payload);

    // Also emit to the service-specific room when available.
    if (payload.ticket?.serviceId) {
      this.server
        .to(`org:${orgId}:service:${payload.ticket.serviceId}`)
        .emit('queue:update', payload);
    }

    // Emit to the ticket-specific room (customer tracking that ticket).
    if (payload.ticket?.id) {
      this.server.to(`ticket:${payload.ticket.id}`).emit('ticket:update', payload);
    }
  }

  /**
   * Emit a "ticket called" event to staff dashboards and public display boards.
   */
  emitTicketCalled(orgId: string, payload: TicketCalledPayload): void {
    this.server.to(`org:${orgId}`).emit('queue:ticket-called', payload);
    this.server.to(`org:${orgId}:display`).emit('queue:ticket-called', payload);
  }

  /**
   * Emit a notification to a specific ticket subscriber (customer's device).
   */
  emitTicketNotification(
    ticketId: string,
    payload: TicketNotificationPayload,
  ): void {
    this.server.to(`ticket:${ticketId}`).emit('ticket:notification', payload);
  }

  // ─── Helpers ──────────────────────────────────────────────────────────

  private authenticate(client: Socket): SocketUser {
    const token = this.extractToken(client);

    if (!token) {
      return { id: client.id, role: 'anonymous' };
    }

    // Throws if the token is invalid or expired -> handled by caller.
    const payload = this.jwtService.verify<JwtPayload>(token, {
      secret: this.configService.get<string>('JWT_ACCESS_SECRET'),
    });

    if (payload.type === 'customer') {
      return { id: payload.sub, role: 'customer' };
    }

    if (payload.orgId && payload.role) {
      return {
        id: payload.sub,
        role: 'staff',
        orgId: payload.orgId,
        staffRole: payload.role,
      };
    }

    // Authenticated but unrecognized shape: treat as least-privileged customer.
    return { id: payload.sub ?? client.id, role: 'customer' };
  }

  private extractToken(client: Socket): string | undefined {
    const authToken = client.handshake.auth?.token;
    if (typeof authToken === 'string' && authToken.length > 0) {
      return authToken.replace(/^Bearer\s+/i, '');
    }

    const header = client.handshake.headers?.authorization;
    if (typeof header === 'string' && header.length > 0) {
      return header.replace(/^Bearer\s+/i, '');
    }

    return undefined;
  }

  private getUser(client: Socket): SocketUser {
    return (
      (client.data.user as SocketUser | undefined) ?? {
        id: client.id,
        role: 'anonymous',
      }
    );
  }

  private emitError(client: Socket, message: string): void {
    client.emit('error', { message });
  }
}
