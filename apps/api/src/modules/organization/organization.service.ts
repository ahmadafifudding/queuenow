import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { UpdateOrganizationDto, UpdateBrandingDto, UpdateSettingsDto } from './dto';

@Injectable()
export class OrganizationService {
  constructor(private readonly prisma: PrismaService) {}

  async findOne(id: string, userOrgId: string) {
    this.validateAccess(id, userOrgId);

    const org = await this.prisma.organization.findUnique({
      where: { id },
      include: {
        branding: true,
        settings: true,
        services: { where: { isActive: true }, orderBy: { sortOrder: 'asc' } },
        _count: {
          select: {
            counters: true,
            userRoles: true,
          },
        },
      },
    });

    if (!org) {
      throw new NotFoundException('Organization not found');
    }

    return org;
  }

  async update(id: string, dto: UpdateOrganizationDto, userOrgId: string) {
    this.validateAccess(id, userOrgId);

    const org = await this.prisma.organization.findUnique({ where: { id } });

    if (!org) {
      throw new NotFoundException('Organization not found');
    }

    return this.prisma.organization.update({
      where: { id },
      data: {
        name: dto.name,
        address: dto.address,
        phone: dto.phone,
        email: dto.email,
        timezone: dto.timezone,
      },
    });
  }

  async updateBranding(id: string, dto: UpdateBrandingDto, userOrgId: string) {
    this.validateAccess(id, userOrgId);

    const org = await this.prisma.organization.findUnique({ where: { id } });

    if (!org) {
      throw new NotFoundException('Organization not found');
    }

    return this.prisma.organizationBranding.upsert({
      where: { orgId: id },
      create: {
        orgId: id,
        logoUrl: dto.logoUrl,
        primaryColor: dto.primaryColor ?? '#3B82F6',
        qrText: dto.qrText ?? 'Scan to join queue',
      },
      update: {
        logoUrl: dto.logoUrl,
        primaryColor: dto.primaryColor,
        qrText: dto.qrText,
      },
    });
  }

  async getSettings(id: string, userOrgId: string) {
    this.validateAccess(id, userOrgId);

    const settings = await this.prisma.queueSettings.findUnique({
      where: { orgId: id },
    });

    if (!settings) {
      // Return defaults if not yet created
      return {
        orgId: id,
        resetTime: '00:00',
        maxRecall: 2,
        requireName: false,
        requirePhone: false,
        customFields: null,
        autoSkipTimeout: null,
      };
    }

    return settings;
  }

  async updateSettings(id: string, dto: UpdateSettingsDto, userOrgId: string) {
    this.validateAccess(id, userOrgId);

    const org = await this.prisma.organization.findUnique({ where: { id } });

    if (!org) {
      throw new NotFoundException('Organization not found');
    }

    return this.prisma.queueSettings.upsert({
      where: { orgId: id },
      create: {
        orgId: id,
        resetTime: dto.resetTime ?? '00:00',
        maxRecall: dto.maxRecall ?? 2,
        requireName: dto.requireName ?? false,
        requirePhone: dto.requirePhone ?? false,
        autoSkipTimeout: dto.autoSkipTimeout,
      },
      update: {
        resetTime: dto.resetTime,
        maxRecall: dto.maxRecall,
        requireName: dto.requireName,
        requirePhone: dto.requirePhone,
        autoSkipTimeout: dto.autoSkipTimeout,
      },
    });
  }

  async getStats(id: string, userOrgId: string) {
    this.validateAccess(id, userOrgId);

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const [waiting, serving, completed, skipped] = await Promise.all([
      this.prisma.queueTicket.count({ where: { orgId: id, status: 'WAITING', createdAt: { gte: today } } }),
      this.prisma.queueTicket.count({ where: { orgId: id, status: 'SERVING', createdAt: { gte: today } } }),
      this.prisma.queueTicket.count({ where: { orgId: id, status: 'COMPLETED', createdAt: { gte: today } } }),
      this.prisma.queueTicket.count({ where: { orgId: id, status: 'SKIPPED', createdAt: { gte: today } } }),
    ]);

    return {
      waiting,
      serving,
      completed,
      skipped,
      total: waiting + serving + completed + skipped,
    };
  }

  private validateAccess(id: string, userOrgId: string): void {
    if (id !== userOrgId) {
      throw new ForbiddenException('Access denied to this organization');
    }
  }
}
