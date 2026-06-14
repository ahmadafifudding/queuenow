import { Injectable, NotFoundException, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Expo, type ExpoPushMessage, type ExpoPushTicket } from 'expo-server-sdk';
import { NotificationType } from '@queuenow/shared-types';
import { PrismaService } from '../../prisma/prisma.service';
import { RegisterPushTokenDto } from './dto';

/** Turn-notification types that map to a customer-facing push alert (R13.2). */
type TurnNotificationType = `${NotificationType}`;

/** Static copy for each turn-notification type, keyed by NotificationType. */
const PUSH_CONTENT: Record<TurnNotificationType, { title: string; body: string }> = {
  [NotificationType.YOUR_TURN]: {
    title: "It's your turn",
    body: 'Please proceed to the counter now.',
  },
  [NotificationType.ALMOST_TURN]: {
    title: 'Almost your turn',
    body: "You're next in line. Please get ready.",
  },
  [NotificationType.SKIPPED]: {
    title: 'Ticket skipped',
    body: 'Your ticket was skipped. Tap to view its current status.',
  },
};

@Injectable()
export class NotificationService {
  private readonly logger = new Logger(NotificationService.name);

  /** Whether push delivery is configured/enabled. When false the service is a no-op. */
  private readonly pushEnabled: boolean;

  /**
   * Expo Push client. Only constructed when delivery is enabled, so the service
   * degrades to a logging no-op when push is not configured.
   */
  private readonly expo: Expo | null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
  ) {
    this.pushEnabled = this.configService.get<boolean>('EXPO_PUSH_ENABLED', false);
    // EXPO_ACCESS_TOKEN is optional even when enabled — Expo accepts unauthenticated sends.
    const accessToken = this.configService.get<string>('EXPO_ACCESS_TOKEN');
    this.expo = this.pushEnabled ? new Expo(accessToken ? { accessToken } : undefined) : null;

    if (!this.pushEnabled) {
      this.logger.warn(
        'Expo push delivery is disabled (EXPO_PUSH_ENABLED is not "true"); notifications will be recorded but not delivered.',
      );
    }
  }

  async registerPushToken(customerId: string, dto: RegisterPushTokenDto) {
    const customer = await this.prisma.customerProfile.findUnique({
      where: { id: customerId },
    });

    if (!customer) {
      throw new NotFoundException('Customer profile not found');
    }

    await this.prisma.customerProfile.update({
      where: { id: customerId },
      data: { pushToken: dto.pushToken },
    });

    return { message: 'Push token registered successfully' };
  }

  async getNotifications(customerId: string, limit: number = 20, offset: number = 0) {
    const [notifications, total] = await Promise.all([
      this.prisma.notification.findMany({
        where: { customerId },
        include: {
          ticket: {
            select: {
              id: true,
              ticketNumber: true,
              orgId: true,
              service: { select: { id: true, name: true } },
            },
          },
        },
        orderBy: { createdAt: 'desc' },
        take: limit,
        skip: offset,
      }),
      this.prisma.notification.count({
        where: { customerId },
      }),
    ]);

    return { notifications, total, limit, offset };
  }

  /**
   * Send notification to a customer - called internally by other services.
   *
   * Always records the notification (PENDING). When the customer has a registered
   * push token and Expo push delivery is enabled, it delivers via Expo Push and
   * marks the record SENT (on success) or FAILED (on a provider/transport error).
   *
   * Graceful degradation (R13.2): a missing push token, disabled delivery, an
   * invalid token, or a provider error never throws — delivery failures are logged
   * and reflected in the record status so the calling queue action is unaffected.
   */
  async sendNotification(ticketId: string, customerId: string, type: TurnNotificationType) {
    const notification = await this.prisma.notification.create({
      data: {
        ticketId,
        customerId,
        type,
        status: 'PENDING',
      },
    });

    // Get the customer push token and the ticket's orgId together. The orgId is
    // needed so the delivered push can deep-link to `/ticket/[orgId]/[ticketId]`
    // on the device (R13.3): the active-ticket route requires BOTH ids, so the
    // push `data` payload must carry `orgId` alongside `ticketId`.
    const [customer, ticket] = await Promise.all([
      this.prisma.customerProfile.findUnique({
        where: { id: customerId },
        select: { pushToken: true },
      }),
      this.prisma.queueTicket.findUnique({
        where: { id: ticketId },
        select: { orgId: true },
      }),
    ]);

    // No registered token: nothing to deliver. Leave the record PENDING and return
    // without error (foreground/in-app alerts remain the guaranteed path).
    if (!customer?.pushToken) {
      this.logger.debug(
        `No push token registered for customer ${customerId}; skipping push delivery for notification ${notification.id} (type=${type}).`,
      );
      return notification;
    }

    await this.deliverPush(notification.id, customer.pushToken, ticketId, ticket?.orgId, type);

    return notification;
  }

  /**
   * Deliver a single push notification through Expo Push and update the record
   * status. All failure modes are handled internally (logged + status update);
   * this method never throws so it cannot crash the calling queue action.
   */
  private async deliverPush(
    notificationId: string,
    pushToken: string,
    ticketId: string,
    orgId: string | undefined,
    type: TurnNotificationType,
  ): Promise<void> {
    // Delivery disabled / not configured: degrade to a no-op. Preserve the prior
    // status semantics (a token-bearing notification is marked SENT) so existing
    // behavior is unchanged until a push provider is configured.
    if (!this.pushEnabled || !this.expo) {
      this.logger.log(
        `Push delivery disabled; recording notification ${notificationId} as SENT without dispatch (type=${type}).`,
      );
      await this.markStatus(notificationId, 'SENT');
      return;
    }

    // Guard against malformed / unregistered tokens before contacting the provider.
    if (!Expo.isExpoPushToken(pushToken)) {
      this.logger.warn(
        `Push token for notification ${notificationId} is not a valid Expo push token; marking FAILED without dispatch.`,
      );
      await this.markStatus(notificationId, 'FAILED');
      return;
    }

    const content = PUSH_CONTENT[type];
    const message: ExpoPushMessage = {
      to: pushToken,
      sound: 'default',
      title: content.title,
      body: content.body,
      // Include orgId so the device can resolve the `/ticket/[orgId]/[ticketId]`
      // deep link on activation (R13.3). When orgId could not be resolved it is
      // simply omitted and the app opens normally rather than deep-linking.
      data: orgId ? { ticketId, orgId, type } : { ticketId, type },
    };

    try {
      const tickets = await this.expo.sendPushNotificationsAsync([message]);
      const ticket: ExpoPushTicket | undefined = tickets[0];

      if (ticket && ticket.status === 'error') {
        this.logger.error(
          `Expo push delivery failed for notification ${notificationId}: ${ticket.message}`,
        );
        await this.markStatus(notificationId, 'FAILED');
        return;
      }

      this.logger.log(`Push notification ${notificationId} delivered (type=${type}).`);
      await this.markStatus(notificationId, 'SENT');
    } catch (error) {
      // Provider/transport error: log and mark FAILED, but do not propagate so the
      // queue action that triggered this notification keeps working (R13.2).
      const reason = error instanceof Error ? error.message : 'unknown error';
      this.logger.error(
        `Failed to deliver push notification ${notificationId} via Expo: ${reason}`,
      );
      await this.markStatus(notificationId, 'FAILED');
    }
  }

  /**
   * Update a notification's delivery status. Status persistence failures are logged
   * and swallowed so they cannot crash the calling flow.
   */
  private async markStatus(notificationId: string, status: 'SENT' | 'FAILED'): Promise<void> {
    try {
      await this.prisma.notification.update({
        where: { id: notificationId },
        data: {
          status,
          sentAt: status === 'SENT' ? new Date() : null,
        },
      });
    } catch (error) {
      const reason = error instanceof Error ? error.message : 'unknown error';
      this.logger.error(
        `Failed to update status for notification ${notificationId} to ${status}: ${reason}`,
      );
    }
  }
}
