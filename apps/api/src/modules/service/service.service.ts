import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  ConflictException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class ServiceService {
  constructor(private readonly prisma: PrismaService) {}

  async create(orgId: string, dto: any, user: any) {
    this.validateOrgAccess(orgId, user);

    // Check for duplicate prefix within org
    const existing = await this.prisma.service.findUnique({
      where: { orgId_prefix: { orgId, prefix: dto.prefix } },
    });

    if (existing) {
      throw new ConflictException(`Service with prefix "${dto.prefix}" already exists`);
    }

    return this.prisma.service.create({
      data: {
        orgId,
        name: dto.name,
        prefix: dto.prefix,
        isActive: dto.isActive ?? true,
        sortOrder: dto.sortOrder ?? 0,
        maxQueuePerDay: dto.maxQueuePerDay,
        avgServingTime: dto.avgServingTime ?? 5,
      },
    });
  }

  async findAll(orgId: string, user: any) {
    this.validateOrgAccess(orgId, user);

    return this.prisma.service.findMany({
      where: { orgId },
      orderBy: { sortOrder: 'asc' },
      include: {
        _count: {
          select: { counters: true, queueTickets: true },
        },
      },
    });
  }

  async findOne(orgId: string, id: string, user: any) {
    this.validateOrgAccess(orgId, user);

    const service = await this.prisma.service.findFirst({
      where: { id, orgId },
      include: {
        counters: { where: { isActive: true } },
        _count: {
          select: { queueTickets: true },
        },
      },
    });

    if (!service) {
      throw new NotFoundException('Service not found');
    }

    return service;
  }

  async update(orgId: string, id: string, dto: any, user: any) {
    this.validateOrgAccess(orgId, user);

    const service = await this.prisma.service.findFirst({
      where: { id, orgId },
    });

    if (!service) {
      throw new NotFoundException('Service not found');
    }

    // Check prefix uniqueness if being updated
    if (dto.prefix && dto.prefix !== service.prefix) {
      const existing = await this.prisma.service.findUnique({
        where: { orgId_prefix: { orgId, prefix: dto.prefix } },
      });
      if (existing) {
        throw new ConflictException(`Service with prefix "${dto.prefix}" already exists`);
      }
    }

    return this.prisma.service.update({
      where: { id },
      data: dto,
    });
  }

  async remove(orgId: string, id: string, user: any) {
    this.validateOrgAccess(orgId, user);

    const service = await this.prisma.service.findFirst({
      where: { id, orgId },
    });

    if (!service) {
      throw new NotFoundException('Service not found');
    }

    await this.prisma.service.delete({ where: { id } });
  }

  private validateOrgAccess(orgId: string, user: any): void {
    if (user.orgId !== orgId) {
      throw new ForbiddenException('Access denied to this organization');
    }
  }
}
