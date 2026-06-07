import {
  Injectable,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class CounterService {
  constructor(private readonly prisma: PrismaService) {}

  async create(orgId: string, dto: any, user: any) {
    this.validateOrgAccess(orgId, user);

    // Verify service exists within org
    const service = await this.prisma.service.findFirst({
      where: { id: dto.serviceId, orgId },
    });

    if (!service) {
      throw new NotFoundException('Service not found in this organization');
    }

    return this.prisma.counter.create({
      data: {
        orgId,
        serviceId: dto.serviceId,
        name: dto.name,
        isActive: dto.isActive ?? true,
      },
      include: {
        service: { select: { id: true, name: true, prefix: true } },
      },
    });
  }

  async findAll(orgId: string, user: any) {
    this.validateOrgAccess(orgId, user);

    return this.prisma.counter.findMany({
      where: { orgId },
      include: {
        service: { select: { id: true, name: true, prefix: true } },
        staffAssignments: {
          where: { releasedAt: null },
          include: { user: { select: { id: true, fullName: true } } },
        },
      },
      orderBy: { name: 'asc' },
    });
  }

  async findOne(orgId: string, id: string, user: any) {
    this.validateOrgAccess(orgId, user);

    const counter = await this.prisma.counter.findFirst({
      where: { id, orgId },
      include: {
        service: { select: { id: true, name: true, prefix: true } },
        staffAssignments: {
          where: { releasedAt: null },
          include: { user: { select: { id: true, fullName: true } } },
        },
      },
    });

    if (!counter) {
      throw new NotFoundException('Counter not found');
    }

    return counter;
  }

  async update(orgId: string, id: string, dto: any, user: any) {
    this.validateOrgAccess(orgId, user);

    const counter = await this.prisma.counter.findFirst({
      where: { id, orgId },
    });

    if (!counter) {
      throw new NotFoundException('Counter not found');
    }

    return this.prisma.counter.update({
      where: { id },
      data: dto,
      include: {
        service: { select: { id: true, name: true, prefix: true } },
      },
    });
  }

  async remove(orgId: string, id: string, user: any) {
    this.validateOrgAccess(orgId, user);

    const counter = await this.prisma.counter.findFirst({
      where: { id, orgId },
    });

    if (!counter) {
      throw new NotFoundException('Counter not found');
    }

    await this.prisma.counter.delete({ where: { id } });
  }

  private validateOrgAccess(orgId: string, user: any): void {
    if (user.orgId !== orgId) {
      throw new ForbiddenException('Access denied to this organization');
    }
  }
}
