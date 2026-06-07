import { Injectable, NotFoundException, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class NotificationService {
  private readonly logger = new Logger(NotificationService.name);

  constructor(private readonly prisma: PrismaService) {}

  async registerPushToken(customerId: string, dto: any) {
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
   * Send notification to a customer - called internally by other services
   */
  async sendNotification(ticketId: string, customerId: string, type: 'YOUR_TURN' | 'ALMOST_TURN' | 'SKIPPED') {
    const notification = await this.prisma.notification.create({
      data: {
        ticketId,
        customerId,
        type,
        status: 'PENDING',
      },
    });

    // Get customer push token
    const customer = await this.prisma.customerProfile.findUnique({
      where: { id: customerId },
      select: { pushToken: true },
    });

    if (customer?.pushToken) {
      // TODO: Integrate with FCM/APNs push notification service
      this.logger.log(
        `Push notification queued for customer ${customerId}: type=${type}, token=${customer.pushToken}`,
      );

      await this.prisma.notification.update({
        where: { id: notification.id },
        data: { status: 'SENT', sentAt: new Date() },
      });
    }

    return notification;
  }
}
