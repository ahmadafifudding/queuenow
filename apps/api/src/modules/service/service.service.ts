import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  ConflictException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { IAuthenticatedUser } from '../../common/interfaces';
import { runSerializable } from '../../common/prisma/run-serializable';
import { PlanLimitsService } from '../plan/plan-limits.service';

@Injectable()
export class ServiceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly planLimits: PlanLimitsService,
  ) {}

  async create(orgId: string, dto: any, user: IAuthenticatedUser) {
    this.validateOrgAccess(orgId, user);

    // Enforce `maxServices` and create atomically: the usage count and the
    // create run in one `Serializable` transaction so concurrent creates cannot
    // both pass the check and overshoot the limit (R1.6). `runSerializable`
    // retries once on a serialization failure (Postgres 40001 / Prisma P2034).
    return runSerializable(this.prisma, async (tx) => {
      // Plan-limit check first, then the existing uniqueness check, both inside
      // the same transaction (R1.1, R1.2, R1.3, R1.5, R1.6).
      await this.planLimits.assertWithinNumericLimit(tx, orgId, 'services');

      // Check for duplicate prefix within org
      const existing = await tx.service.findUnique({
        where: { orgId_prefix: { orgId, prefix: dto.prefix } },
      });

      if (existing) {
        throw new ConflictException(`Service with prefix "${dto.prefix}" already exists`);
      }

      return tx.service.create({
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
    });
  }

  async findAll(orgId: string, user: IAuthenticatedUser) {
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

  async findOne(orgId: string, id: string, user: IAuthenticatedUser) {
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

  async update(orgId: string, id: string, dto: any, user: IAuthenticatedUser) {
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

  async remove(orgId: string, id: string, user: IAuthenticatedUser) {
    this.validateOrgAccess(orgId, user);

    const service = await this.prisma.service.findFirst({
      where: { id, orgId },
    });

    if (!service) {
      throw new NotFoundException('Service not found');
    }

    await this.prisma.service.delete({ where: { id } });
  }

  private validateOrgAccess(orgId: string, user: IAuthenticatedUser): void {
    if (user.orgId !== orgId) {
      throw new ForbiddenException('Access denied to this organization');
    }
  }
}
