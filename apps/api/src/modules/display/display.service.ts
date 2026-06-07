import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class DisplayService {
  constructor(private readonly prisma: PrismaService) {}

  async getDisplayData(orgId: string, serviceId?: string) {
    const org = await this.prisma.organization.findFirst({
      where: { id: orgId, isActive: true },
      include: {
        branding: true,
      },
    });

    if (!org) {
      throw new NotFoundException('Organization not found');
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const serviceFilter = serviceId ? { id: serviceId } : {};

    // Get services with their queue info
    const services = await this.prisma.service.findMany({
      where: { orgId, isActive: true, ...serviceFilter },
      select: { id: true, name: true, prefix: true },
      orderBy: { sortOrder: 'asc' },
    });

    // Get currently called tickets
    const calledTickets = await this.prisma.queueTicket.findMany({
      where: {
        orgId,
        status: 'CALLED',
        createdAt: { gte: today },
        ...(serviceId ? { serviceId } : {}),
      },
      include: {
        service: { select: { id: true, name: true, prefix: true } },
        counter: { select: { id: true, name: true } },
      },
      orderBy: { calledAt: 'desc' },
    });

    // Get waiting counts per service
    const waitingCounts = await Promise.all(
      services.map(async (service) => ({
        serviceId: service.id,
        serviceName: service.name,
        prefix: service.prefix,
        waiting: await this.prisma.queueTicket.count({
          where: {
            orgId,
            serviceId: service.id,
            status: 'WAITING',
            createdAt: { gte: today },
          },
        }),
      })),
    );

    return {
      organization: {
        id: org.id,
        name: org.name,
        branding: org.branding,
      },
      nowServing: calledTickets.map((ticket) => ({
        ticketNumber: ticket.ticketNumber,
        counterName: ticket.counter?.name,
        serviceName: ticket.service.name,
        calledAt: ticket.calledAt,
      })),
      waitingCounts,
      lastUpdated: new Date().toISOString(),
    };
  }

  async getNowServing(orgId: string) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const calledTickets = await this.prisma.queueTicket.findMany({
      where: {
        orgId,
        status: 'CALLED',
        createdAt: { gte: today },
      },
      include: {
        service: { select: { id: true, name: true } },
        counter: { select: { id: true, name: true } },
      },
      orderBy: { calledAt: 'desc' },
    });

    return calledTickets.map((ticket) => ({
      ticketNumber: ticket.ticketNumber,
      counterName: ticket.counter?.name,
      serviceName: ticket.service.name,
      calledAt: ticket.calledAt,
    }));
  }

  async getBranding(orgId: string) {
    const branding = await this.prisma.organizationBranding.findUnique({
      where: { orgId },
    });

    if (!branding) {
      throw new NotFoundException('Branding not found for this organization');
    }

    return branding;
  }
}
