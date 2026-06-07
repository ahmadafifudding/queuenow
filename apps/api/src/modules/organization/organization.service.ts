import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class OrganizationService {
  constructor(private readonly prisma: PrismaService) {}

  async findOne(id: string, userOrgId: string) {
    if (id !== userOrgId) {
      throw new ForbiddenException('Access denied');
    }

    const org = await this.prisma.organization.findUnique({
      where: { id },
      include: {
        branding: true,
        settings: true,
        services: { where: { isActive: true }, orderBy: { sortOrder: 'asc' } },
      },
    });

    if (!org) {
      throw new NotFoundException('Organization not found');
    }

    return org;
  }

  async update(id: string, dto: any, userOrgId: string) {
    if (id !== userOrgId) {
      throw new ForbiddenException('Access denied');
    }

    return this.prisma.organization.update({
      where: { id },
      data: dto,
    });
  }

  async getStats(id: string, userOrgId: string) {
    if (id !== userOrgId) {
      throw new ForbiddenException('Access denied');
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const [waiting, serving, completed, skipped] = await Promise.all([
      this.prisma.queueTicket.count({ where: { orgId: id, status: 'WAITING', createdAt: { gte: today } } }),
      this.prisma.queueTicket.count({ where: { orgId: id, status: 'SERVING', createdAt: { gte: today } } }),
      this.prisma.queueTicket.count({ where: { orgId: id, status: 'COMPLETED', createdAt: { gte: today } } }),
      this.prisma.queueTicket.count({ where: { orgId: id, status: 'SKIPPED', createdAt: { gte: today } } }),
    ]);

    return { waiting, serving, completed, skipped, total: waiting + serving + completed + skipped };
  }
}
