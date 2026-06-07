import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { QueueGateway } from './queue.gateway';

@Injectable()
export class QueueService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly queueGateway: QueueGateway,
  ) {}

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

    // Get or create daily counter for this service
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const dailyCounter = await this.prisma.dailyQueueCounter.upsert({
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
    const ticket = await this.prisma.queueTicket.create({
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
      ticket: { id: ticket.id, ticketNumber, status: 'WAITING', serviceId: dto.serviceId },
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
  async callNext(orgId: string, dto: any, user: any) {
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
        calledById: user.sub,
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

    return updatedTicket;
  }

  /**
   * Recall a customer - maximum 2 times as per queue settings
   * After max recalls, the ticket should be skipped
   */
  async recall(orgId: string, ticketId: string, user: any) {
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

    return updatedTicket;
  }

  /**
   * Skip a called customer - moves them to SKIPPED status
   * Skipped customers can be rejoined later by staff
   */
  async skip(orgId: string, ticketId: string, user: any) {
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

    return updatedTicket;
  }

  /**
   * Complete serving a customer - moves from CALLED/SERVING to COMPLETED
   */
  async complete(orgId: string, ticketId: string, user: any) {
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
        completedById: user.sub,
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
  async rejoin(orgId: string, ticketId: string, user: any) {
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

  private validateStaffOrgAccess(orgId: string, user: any): void {
    if (user.orgId !== orgId) {
      throw new ForbiddenException('Access denied to this organization');
    }
  }
}
