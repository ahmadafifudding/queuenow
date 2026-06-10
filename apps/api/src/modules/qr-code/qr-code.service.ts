import {
  Injectable,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';
import { IAuthenticatedUser } from '../../common/interfaces';

@Injectable()
export class QrCodeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
  ) {}

  async generateOrgQrUrl(orgId: string, user: IAuthenticatedUser) {
    this.validateOrgAccess(orgId, user);

    const org = await this.prisma.organization.findFirst({
      where: { id: orgId, isActive: true },
      include: { branding: true },
    });

    if (!org) {
      throw new NotFoundException('Organization not found');
    }

    const baseUrl = this.configService.get<string>('APP_BASE_URL', 'https://queue.app');
    const joinUrl = `${baseUrl}/join/${org.slug}`;

    return {
      url: joinUrl,
      qrData: joinUrl,
      organization: {
        id: org.id,
        name: org.name,
        slug: org.slug,
      },
      branding: {
        logoUrl: org.branding?.logoUrl,
        primaryColor: org.branding?.primaryColor,
        qrText: org.branding?.qrText,
      },
    };
  }

  async generateServiceQrUrl(orgId: string, serviceId: string, user: IAuthenticatedUser) {
    this.validateOrgAccess(orgId, user);

    const service = await this.prisma.service.findFirst({
      where: { id: serviceId, orgId, isActive: true },
    });

    if (!service) {
      throw new NotFoundException('Service not found');
    }

    const org = await this.prisma.organization.findFirst({
      where: { id: orgId },
      include: { branding: true },
    });

    if (!org) {
      throw new NotFoundException('Organization not found');
    }

    const baseUrl = this.configService.get<string>('APP_BASE_URL', 'https://queue.app');
    const joinUrl = `${baseUrl}/join/${org.slug}?service=${serviceId}`;

    return {
      url: joinUrl,
      qrData: joinUrl,
      organization: {
        id: org.id,
        name: org.name,
        slug: org.slug,
      },
      service: {
        id: service.id,
        name: service.name,
        prefix: service.prefix,
      },
      branding: {
        logoUrl: org.branding?.logoUrl,
        primaryColor: org.branding?.primaryColor,
        qrText: org.branding?.qrText,
      },
    };
  }

  private validateOrgAccess(orgId: string, user: IAuthenticatedUser): void {
    if (user.orgId !== orgId) {
      throw new ForbiddenException('Access denied to this organization');
    }
  }
}
