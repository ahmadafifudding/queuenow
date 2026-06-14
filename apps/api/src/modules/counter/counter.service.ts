import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { IAuthenticatedUser } from '../../common/interfaces';
import { runSerializable } from '../../common/prisma/run-serializable';
import { PlanLimitsService } from '../plan/plan-limits.service';

@Injectable()
export class CounterService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly planLimits: PlanLimitsService,
  ) {}

  async create(orgId: string, dto: any, user: IAuthenticatedUser) {
    this.validateOrgAccess(orgId, user);

    // Enforce `maxCounters` and create atomically: the plan-limit count and the
    // create run in one `Serializable` transaction (retry-once on serialization
    // failure) so concurrent creates cannot both pass the check and overshoot
    // the limit (R1.1, R1.2, R1.3, R1.5, R1.6).
    return runSerializable(this.prisma, async (tx) => {
      await this.planLimits.assertWithinNumericLimit(tx, orgId, 'counters');

      // Verify service exists within org (kept inside the tx).
      const service = await tx.service.findFirst({
        where: { id: dto.serviceId, orgId },
      });

      if (!service) {
        throw new NotFoundException('Service not found in this organization');
      }

      return tx.counter.create({
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
    });
  }

  async findAll(orgId: string, user: IAuthenticatedUser) {
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

  async findOne(orgId: string, id: string, user: IAuthenticatedUser) {
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

  async update(orgId: string, id: string, dto: any, user: IAuthenticatedUser) {
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

  async remove(orgId: string, id: string, user: IAuthenticatedUser) {
    this.validateOrgAccess(orgId, user);

    const counter = await this.prisma.counter.findFirst({
      where: { id, orgId },
    });

    if (!counter) {
      throw new NotFoundException('Counter not found');
    }

    await this.prisma.counter.delete({ where: { id } });
  }

  private validateOrgAccess(orgId: string, user: IAuthenticatedUser): void {
    if (user.orgId !== orgId) {
      throw new ForbiddenException('Access denied to this organization');
    }
  }
}
