import {
  Injectable,
  Logger,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { ERROR_CODES } from '@queuenow/shared-constants';
import { NotificationType } from '@queuenow/shared-types';
import { PrismaService } from '../../prisma/prisma.service';
import { QueueGateway } from './queue.gateway';
import { AuthForbiddenException } from '../../common/exceptions/auth-forbidden.exception';
import { IAuthenticatedUser } from '../../common/interfaces';
import { PlanLimitsService } from '../plan/plan-limits.service';
import { NotificationService } from '../notification/notification.service';
import { CancelTicketDto } from './dto';

@Injectable()
export class QueueService {
  private readonly logger = new Logger(QueueService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly queueGateway: QueueGateway,
    private readonly planLimits: PlanLimitsService,
    private readonly notificationService: NotificationService,
  ) {}

  /**
   * Dual-channel turn-alert delivery for a single ticket.
   * - Socket channel ALWAYS fires (works for anonymous tickets).
   * - Push channel fires iff the ticket has a non-null customerProfileId.
   * All failures are swallowed/logged so a delivery error can never fail or roll
   * back the queue action (R2.8). sendNotification never throws, but the socket
   * emit is still guarded defensively. Called exactly once per affected ticket
   * per type per transition (structural idempotency, R2.7).
   */
  private async emitTurnAlert(
    ticket: { id: string; customerProfileId: string | null },
    type: NotificationType,
    counterName?: string,
  ): Promise<void> {
    // Build payload: counterName included only for YOUR_TURN (R2.1/R2.3).
    const payload = counterName !== undefined ? { type, counterName } : { type };
    try {
      this.queueGateway.emitTicketNotification(ticket.id, payload);
    } catch (error) {
      const reason = error instanceof Error ? error.message : 'unknown error';
      this.logger.error(`emitTicketNotification failed for ticket ${ticket.id}: ${reason}`);
    }
    if (ticket.customerProfileId) {
      // sendNotification already never throws; guarded anyway for defense in depth.
      try {
        await this.notificationService.sendNotification(ticket.id, ticket.customerProfileId, type);
      } catch (error) {
        const reason = error instanceof Error ? error.message : 'unknown error';
        this.logger.error(`sendNotification failed for ticket ${ticket.id}: ${reason}`);
      }
    }
  }

  /**
   * Join the queue - public endpoint for customers
   * Generates a new ticket number based on service prefix + daily counter
   */
  async joinQueue(orgId: string, dto: any) {
    // Validate organization exists and is active
    const org = await this.prisma.organization.findFirst({
      where: { id: orgId, isActive: true },
      include: { settings: true },
    });

    if (!org) {
      throw new NotFoundException('Organization not found or inactive');
    }

    // Validate service exists
    const service = await this.prisma.service.findFirst({
      where: { id: dto.serviceId, orgId, isActive: true },
    });

    if (!service) {
      throw new NotFoundException('Service not found or inactive');
    }

    // Check max queue per day limit
    if (service.maxQueuePerDay) {
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      const todayCount = await this.prisma.queueTicket.count({
        where: {
          orgId,
          serviceId: dto.serviceId,
          createdAt: { gte: today },
        },
      });

      if (todayCount >= service.maxQueuePerDay) {
        throw new BadRequestException('Queue is full for today. Please try again tomorrow.');
      }
    }

    // Server-local midnight key for the per-service daily counter (preserves the
    // existing counter `date` keying — see the timezone note below).
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // Plan-level daily-queue-volume enforcement (R2) is atomic with the create:
    // the volume check, the counter increment, and the ticket create all run in
    // ONE transaction so concurrent joins cannot both pass the check and
    // overshoot `maxQueuePerDay`. The plan check runs FIRST, before any mutation,
    // so a rejection leaves the daily counter (and therefore the measured volume)
    // unchanged (R2.2).
    const ticket = await this.prisma.$transaction(async (tx) => {
      // R2.1/R2.2/R2.3: throws PlanLimitExceededException when the org's plan
      // `maxQueuePerDay` would be exceeded; returns immediately when unlimited.
      await this.planLimits.assertWithinDailyQueueLimit(tx, orgId);

      // Get or create daily counter for this service (monotonic created-count).
      const dailyCounter = await tx.dailyQueueCounter.upsert({
        where: {
          orgId_serviceId_date: { orgId, serviceId: dto.serviceId, date: today },
        },
        create: {
          orgId,
          serviceId: dto.serviceId,
          date: today,
          lastNumber: 1,
        },
        update: {
          lastNumber: { increment: 1 },
        },
      });

      // Generate ticket number: PREFIX + padded number (e.g., A001, B002)
      const ticketNumber = `${service.prefix}${String(dailyCounter.lastNumber).padStart(3, '0')}`;

      // Create the queue ticket
      return tx.queueTicket.create({
        data: {
          orgId,
          serviceId: dto.serviceId,
          ticketNumber,
          dailyNumber: dailyCounter.lastNumber,
          status: 'WAITING',
          customerName: dto.customerName,
          customerPhone: dto.customerPhone,
          customerProfileId: dto.customerProfileId,
          deviceFingerprint: dto.deviceFingerprint,
        },
        include: {
          service: { select: { id: true, name: true, prefix: true, avgServingTime: true } },
        },
      });
    });

    // Calculate position in queue
    const position = await this.prisma.queueTicket.count({
      where: {
        orgId,
        serviceId: dto.serviceId,
        status: 'WAITING',
        createdAt: { lte: ticket.createdAt },
      },
    });

    // Estimated wait time based on average serving time
    const estimatedWaitMinutes = (position - 1) * service.avgServingTime;

    // Emit real-time update
    this.queueGateway.emitQueueUpdate(orgId, {
      type: 'TICKET_JOINED',
      ticket: {
        id: ticket.id,
        ticketNumber: ticket.ticketNumber,
        status: 'WAITING',
        serviceId: dto.serviceId,
      },
    });

    return {
      ...ticket,
      position,
      estimatedWaitMinutes,
    };
  }

  /**
   * Call next customer in the queue - FIFO order
   * Staff must specify their counter; calls the oldest WAITING ticket for that counter's service
   */
  async callNext(orgId: string, dto: any, user: IAuthenticatedUser) {
    this.validateStaffOrgAccess(orgId, user);

    const { counterId } = dto;

    // Get counter and its service
    const counter = await this.prisma.counter.findFirst({
      where: { id: counterId, orgId, isActive: true },
      include: { service: true },
    });

    if (!counter) {
      throw new NotFoundException('Counter not found or inactive');
    }

    // Find the next waiting ticket (FIFO - oldest first)
    const nextTicket = await this.prisma.queueTicket.findFirst({
      where: {
        orgId,
        serviceId: counter.serviceId,
        status: 'WAITING',
      },
      orderBy: { createdAt: 'asc' },
    });

    if (!nextTicket) {
      throw new NotFoundException('No customers waiting in queue');
    }

    // Update ticket status to CALLED
    const updatedTicket = await this.prisma.queueTicket.update({
      where: { id: nextTicket.id },
      data: {
        status: 'CALLED',
        counterId,
        calledById: user.id,
        calledAt: new Date(),
      },
      include: {
        service: { select: { id: true, name: true, prefix: true } },
        counter: { select: { id: true, name: true } },
        calledBy: { select: { id: true, fullName: true } },
      },
    });

    // Emit real-time update
    this.queueGateway.emitQueueUpdate(orgId, {
      type: 'TICKET_CALLED',
      ticket: {
        id: updatedTicket.id,
        ticketNumber: updatedTicket.ticketNumber,
        status: 'CALLED',
        counterName: counter.name,
        serviceId: counter.serviceId,
      },
    });

    // Emit specific notification for display screens
    this.queueGateway.emitTicketCalled(orgId, {
      ticketNumber: updatedTicket.ticketNumber,
      counterName: counter.name,
      serviceName: counter.service.name,
    });

    // Turn-alert wiring (appended AFTER all pre-existing emissions). The called
    // ticket receives YOUR_TURN with the counter it was called to (R2.1, R2.2).
    await this.emitTurnAlert(updatedTicket, NotificationType.YOUR_TURN, counter.name);

    // ALMOST_TURN for the new front-of-line WAITING ticket. The just-called
    // ticket is now CALLED, so this WAITING query excludes it and returns the
    // next ticket the next callNext would serve (R2.5). Guarded so a lookup or
    // delivery failure can never fail the callNext action (R2.8).
    try {
      const nextWaiting = await this.prisma.queueTicket.findFirst({
        where: { orgId, serviceId: counter.serviceId, status: 'WAITING' },
        orderBy: { createdAt: 'asc' },
        select: { id: true, customerProfileId: true },
      });
      if (nextWaiting) {
        await this.emitTurnAlert(nextWaiting, NotificationType.ALMOST_TURN);
      }
    } catch (error) {
      const reason = error instanceof Error ? error.message : 'unknown error';
      this.logger.error(`ALMOST_TURN next-waiting lookup failed for org ${orgId}: ${reason}`);
    }

    return updatedTicket;
  }

  /**
   * Recall a customer - maximum 2 times as per queue settings
   * After max recalls, the ticket should be skipped
   */
  async recall(orgId: string, ticketId: string, user: IAuthenticatedUser) {
    this.validateStaffOrgAccess(orgId, user);

    const ticket = await this.prisma.queueTicket.findFirst({
      where: { id: ticketId, orgId, status: 'CALLED' },
      include: { counter: true },
    });

    if (!ticket) {
      throw new NotFoundException('Ticket not found or not in CALLED status');
    }

    // Get max recall setting
    const settings = await this.prisma.queueSettings.findUnique({
      where: { orgId },
    });

    const maxRecall = settings?.maxRecall ?? 2;

    if (ticket.recallCount >= maxRecall) {
      throw new BadRequestException(
        `Maximum recall limit (${maxRecall}) reached. Please skip this ticket.`,
      );
    }

    // Increment recall count
    const updatedTicket = await this.prisma.queueTicket.update({
      where: { id: ticketId },
      data: {
        recallCount: { increment: 1 },
      },
      include: {
        service: { select: { id: true, name: true, prefix: true } },
        counter: { select: { id: true, name: true } },
      },
    });

    // Emit recall event
    this.queueGateway.emitQueueUpdate(orgId, {
      type: 'TICKET_RECALLED',
      ticket: {
        id: updatedTicket.id,
        ticketNumber: updatedTicket.ticketNumber,
        recallCount: updatedTicket.recallCount,
        counterName: ticket.counter?.name,
        serviceId: updatedTicket.serviceId,
      },
    });

    this.queueGateway.emitTicketCalled(orgId, {
      ticketNumber: updatedTicket.ticketNumber,
      counterName: ticket.counter?.name ?? 'Unknown',
      serviceName: updatedTicket.service.name,
      isRecall: true,
      recallCount: updatedTicket.recallCount,
    });

    // Turn-alert wiring (appended AFTER all pre-existing emissions). Recall is an
    // explicit re-summon: YOUR_TURN fires again on both channels, using the
    // ticket's existing counter (R2.3).
    await this.emitTurnAlert(updatedTicket, NotificationType.YOUR_TURN, ticket.counter?.name);

    return updatedTicket;
  }

  /**
   * Skip a called customer - moves them to SKIPPED status
   * Skipped customers can be rejoined later by staff
   */
  async skip(orgId: string, ticketId: string, user: IAuthenticatedUser) {
    this.validateStaffOrgAccess(orgId, user);

    const ticket = await this.prisma.queueTicket.findFirst({
      where: { id: ticketId, orgId, status: 'CALLED' },
    });

    if (!ticket) {
      throw new NotFoundException('Ticket not found or not in CALLED status');
    }

    const updatedTicket = await this.prisma.queueTicket.update({
      where: { id: ticketId },
      data: {
        status: 'SKIPPED',
        skippedAt: new Date(),
      },
      include: {
        service: { select: { id: true, name: true, prefix: true } },
        counter: { select: { id: true, name: true } },
      },
    });

    // Update daily counter stats
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    await this.prisma.dailyQueueCounter.updateMany({
      where: {
        orgId,
        serviceId: ticket.serviceId,
        date: today,
      },
      data: { totalSkipped: { increment: 1 } },
    });

    // Emit real-time update
    this.queueGateway.emitQueueUpdate(orgId, {
      type: 'TICKET_SKIPPED',
      ticket: {
        id: updatedTicket.id,
        ticketNumber: updatedTicket.ticketNumber,
        status: 'SKIPPED',
        serviceId: updatedTicket.serviceId,
      },
    });

    // Turn-alert wiring (appended AFTER all pre-existing emissions). SKIPPED fires
    // with no counterName (R2.4).
    await this.emitTurnAlert(updatedTicket, NotificationType.SKIPPED);

    return updatedTicket;
  }

  /**
   * Complete serving a customer - moves from CALLED/SERVING to COMPLETED
   */
  async complete(orgId: string, ticketId: string, user: IAuthenticatedUser) {
    this.validateStaffOrgAccess(orgId, user);

    const ticket = await this.prisma.queueTicket.findFirst({
      where: {
        id: ticketId,
        orgId,
        status: { in: ['CALLED', 'SERVING'] },
      },
    });

    if (!ticket) {
      throw new NotFoundException('Ticket not found or not in CALLED/SERVING status');
    }

    const updatedTicket = await this.prisma.queueTicket.update({
      where: { id: ticketId },
      data: {
        status: 'COMPLETED',
        completedById: user.id,
        completedAt: new Date(),
        servingAt: ticket.servingAt ?? ticket.calledAt,
      },
      include: {
        service: { select: { id: true, name: true, prefix: true } },
        counter: { select: { id: true, name: true } },
        completedBy: { select: { id: true, fullName: true } },
      },
    });

    // Update daily counter stats
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    await this.prisma.dailyQueueCounter.updateMany({
      where: {
        orgId,
        serviceId: ticket.serviceId,
        date: today,
      },
      data: { totalServed: { increment: 1 } },
    });

    // Emit real-time update
    this.queueGateway.emitQueueUpdate(orgId, {
      type: 'TICKET_COMPLETED',
      ticket: {
        id: updatedTicket.id,
        ticketNumber: updatedTicket.ticketNumber,
        status: 'COMPLETED',
        serviceId: updatedTicket.serviceId,
      },
    });

    return updatedTicket;
  }

  /**
   * Rejoin a skipped customer - places them back in WAITING status
   * Creates a new entry at the end of the queue with isRejoin flag
   */
  async rejoin(orgId: string, ticketId: string, user: IAuthenticatedUser) {
    this.validateStaffOrgAccess(orgId, user);

    const ticket = await this.prisma.queueTicket.findFirst({
      where: { id: ticketId, orgId, status: 'SKIPPED' },
    });

    if (!ticket) {
      throw new NotFoundException('Ticket not found or not in SKIPPED status');
    }

    // Reset ticket to WAITING with rejoin flag
    const updatedTicket = await this.prisma.queueTicket.update({
      where: { id: ticketId },
      data: {
        status: 'WAITING',
        isRejoin: true,
        counterId: null,
        calledById: null,
        calledAt: null,
        skippedAt: null,
        recallCount: 0,
        // Update createdAt to place at end of queue
        createdAt: new Date(),
      },
      include: {
        service: { select: { id: true, name: true, prefix: true } },
      },
    });

    // Revert daily skip counter
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    await this.prisma.dailyQueueCounter.updateMany({
      where: {
        orgId,
        serviceId: ticket.serviceId,
        date: today,
        totalSkipped: { gt: 0 },
      },
      data: { totalSkipped: { decrement: 1 } },
    });

    // Calculate new position
    const position = await this.prisma.queueTicket.count({
      where: {
        orgId,
        serviceId: ticket.serviceId,
        status: 'WAITING',
        createdAt: { lte: updatedTicket.createdAt },
      },
    });

    // Emit real-time update
    this.queueGateway.emitQueueUpdate(orgId, {
      type: 'TICKET_REJOINED',
      ticket: {
        id: updatedTicket.id,
        ticketNumber: updatedTicket.ticketNumber,
        status: 'WAITING',
        position,
        serviceId: updatedTicket.serviceId,
      },
    });

    return { ...updatedTicket, position };
  }

  /**
   * Get current queue status - public endpoint
   * Returns waiting count, currently serving, and estimated wait times
   */
  async getCurrentStatus(orgId: string, serviceId?: string) {
    const org = await this.prisma.organization.findFirst({
      where: { id: orgId, isActive: true },
      include: {
        services: {
          where: {
            isActive: true,
            ...(serviceId ? { id: serviceId } : {}),
          },
          select: { id: true, name: true, prefix: true, avgServingTime: true },
        },
      },
    });

    if (!org) {
      throw new NotFoundException('Organization not found');
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // Build status for each service
    const serviceStatuses = await Promise.all(
      org.services.map(async (service) => {
        const [waitingCount, calledTickets, servingCount, completedToday] = await Promise.all([
          this.prisma.queueTicket.count({
            where: { orgId, serviceId: service.id, status: 'WAITING', createdAt: { gte: today } },
          }),
          this.prisma.queueTicket.findMany({
            where: { orgId, serviceId: service.id, status: 'CALLED', createdAt: { gte: today } },
            include: { counter: { select: { id: true, name: true } } },
            orderBy: { calledAt: 'desc' },
            take: 5,
          }),
          this.prisma.queueTicket.count({
            where: { orgId, serviceId: service.id, status: 'SERVING', createdAt: { gte: today } },
          }),
          this.prisma.queueTicket.count({
            where: { orgId, serviceId: service.id, status: 'COMPLETED', createdAt: { gte: today } },
          }),
        ]);

        return {
          service: {
            id: service.id,
            name: service.name,
            prefix: service.prefix,
          },
          waiting: waitingCount,
          currentlyCalled: calledTickets.map((t) => ({
            ticketNumber: t.ticketNumber,
            counterName: t.counter?.name,
          })),
          serving: servingCount,
          completedToday,
          estimatedWaitMinutes: waitingCount * service.avgServingTime,
        };
      }),
    );

    return {
      organizationId: orgId,
      organizationName: org.name,
      services: serviceStatuses,
      lastUpdated: new Date().toISOString(),
    };
  }

  /**
   * Get specific ticket status - for customer tracking
   */
  async getTicketStatus(orgId: string, ticketId: string) {
    const ticket = await this.prisma.queueTicket.findFirst({
      where: { id: ticketId, orgId },
      include: {
        service: { select: { id: true, name: true, prefix: true, avgServingTime: true } },
        counter: { select: { id: true, name: true } },
      },
    });

    if (!ticket) {
      throw new NotFoundException('Ticket not found');
    }

    let position: number | null = null;
    let estimatedWaitMinutes: number | null = null;

    if (ticket.status === 'WAITING') {
      position = await this.prisma.queueTicket.count({
        where: {
          orgId,
          serviceId: ticket.serviceId,
          status: 'WAITING',
          createdAt: { lte: ticket.createdAt },
        },
      });
      estimatedWaitMinutes = (position - 1) * ticket.service.avgServingTime;
    }

    return {
      ...ticket,
      position,
      estimatedWaitMinutes,
    };
  }

  /**
   * Cancel/leave own ticket - public, ownership-scoped endpoint for customers
   * Transitions the caller's own WAITING ticket out of the active queue.
   *
   * Authorization is by OWNERSHIP (not staff role): the stored ticket's
   * `deviceFingerprint` OR `customerProfileId` must match the request body.
   *
   * Terminal status note: the TicketStatus enum has no dedicated CANCELLED
   * value (WAITING | CALLED | SERVING | COMPLETED | SKIPPED). SKIPPED is the
   * closest existing terminal status — it removes the ticket from the active
   * queue without counting it as served (COMPLETED would inflate served stats).
   * We mirror staff `skip()`: set SKIPPED + skippedAt and bump the daily
   * totalSkipped counter so reporting stays consistent.
   */
  async cancelTicket(orgId: string, ticketId: string, dto: CancelTicketDto) {
    const ticket = await this.prisma.queueTicket.findFirst({
      where: { id: ticketId, orgId },
    });

    if (!ticket) {
      throw new NotFoundException('Ticket not found');
    }

    // Ownership check: the request must positively match the stored fingerprint
    // or profile. A missing/null stored value never authorizes (no null == null).
    const matchesFingerprint =
      !!dto.deviceFingerprint && ticket.deviceFingerprint === dto.deviceFingerprint;
    const matchesProfile =
      !!dto.customerProfileId && ticket.customerProfileId === dto.customerProfileId;

    if (!matchesFingerprint && !matchesProfile) {
      throw new AuthForbiddenException('You do not have access to this ticket');
    }

    // Only a WAITING ticket can be left/cancelled by its owner.
    if (ticket.status !== 'WAITING') {
      throw new BadRequestException({
        code: ERROR_CODES.QUEUE_INVALID_STATUS,
        message: 'Ticket is no longer waiting and cannot be cancelled',
      });
    }

    const updatedTicket = await this.prisma.queueTicket.update({
      where: { id: ticketId },
      data: {
        status: 'SKIPPED',
        skippedAt: new Date(),
      },
      include: {
        service: { select: { id: true, name: true, prefix: true } },
        counter: { select: { id: true, name: true } },
      },
    });

    // Update daily counter stats (mirror staff skip()).
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    await this.prisma.dailyQueueCounter.updateMany({
      where: {
        orgId,
        serviceId: ticket.serviceId,
        date: today,
      },
      data: { totalSkipped: { increment: 1 } },
    });

    // Emit real-time update (queue:update to org/service rooms + ticket:update
    // to the ticket room) so subscribers update live.
    this.queueGateway.emitQueueUpdate(orgId, {
      type: 'TICKET_CANCELLED',
      ticket: {
        id: updatedTicket.id,
        ticketNumber: updatedTicket.ticketNumber,
        status: 'SKIPPED',
        serviceId: updatedTicket.serviceId,
      },
    });

    return updatedTicket;
  }

  private validateStaffOrgAccess(orgId: string, user: IAuthenticatedUser): void {
    if (user.orgId !== orgId) {
      throw new ForbiddenException('Access denied to this organization');
    }
  }
}
