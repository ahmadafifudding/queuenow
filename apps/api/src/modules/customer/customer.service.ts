import {
  Injectable,
  NotFoundException,
  UnauthorizedException,
  ConflictException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class CustomerService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
  ) {}

  async register(dto: any) {
    // Check if email already exists
    if (dto.email) {
      const existing = await this.prisma.customerProfile.findUnique({
        where: { email: dto.email },
      });
      if (existing) {
        throw new ConflictException('Email already registered');
      }
    }

    const passwordHash = await bcrypt.hash(dto.password, 12);

    const customer = await this.prisma.customerProfile.create({
      data: {
        email: dto.email,
        phone: dto.phone,
        fullName: dto.fullName,
        passwordHash,
      },
    });

    const tokens = await this.generateTokens(customer.id);

    return {
      customer: {
        id: customer.id,
        email: customer.email,
        phone: customer.phone,
        fullName: customer.fullName,
      },
      tokens,
    };
  }

  async login(dto: any) {
    const customer = await this.prisma.customerProfile.findFirst({
      where: {
        OR: [
          { email: dto.email },
          { phone: dto.phone },
        ].filter((c) => Object.values(c)[0] !== undefined),
      },
    });

    if (!customer || !customer.passwordHash) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const isPasswordValid = await bcrypt.compare(dto.password, customer.passwordHash);
    if (!isPasswordValid) {
      throw new UnauthorizedException('Invalid credentials');
    }

    await this.prisma.customerProfile.update({
      where: { id: customer.id },
      data: { lastLoginAt: new Date() },
    });

    const tokens = await this.generateTokens(customer.id);

    return {
      customer: {
        id: customer.id,
        email: customer.email,
        phone: customer.phone,
        fullName: customer.fullName,
        avatarUrl: customer.avatarUrl,
      },
      tokens,
    };
  }

  async getProfile(customerId: string) {
    const customer = await this.prisma.customerProfile.findUnique({
      where: { id: customerId },
      select: {
        id: true,
        email: true,
        phone: true,
        fullName: true,
        avatarUrl: true,
        createdAt: true,
      },
    });

    if (!customer) {
      throw new NotFoundException('Customer profile not found');
    }

    return customer;
  }

  async updateProfile(customerId: string, dto: any) {
    const customer = await this.prisma.customerProfile.findUnique({
      where: { id: customerId },
    });

    if (!customer) {
      throw new NotFoundException('Customer profile not found');
    }

    return this.prisma.customerProfile.update({
      where: { id: customerId },
      data: {
        fullName: dto.fullName,
        phone: dto.phone,
        avatarUrl: dto.avatarUrl,
      },
      select: {
        id: true,
        email: true,
        phone: true,
        fullName: true,
        avatarUrl: true,
      },
    });
  }

  async getHistory(customerId: string) {
    return this.prisma.queueTicket.findMany({
      where: { customerProfileId: customerId },
      include: {
        service: { select: { id: true, name: true } },
        organization: { select: { id: true, name: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
  }

  async getFavorites(customerId: string) {
    const favorites = await this.prisma.customerFavorite.findMany({
      where: { customerId },
      select: {
        id: true,
        orgId: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'desc' },
    });

    // Fetch organization details for each favorite
    const orgIds = favorites.map((f) => f.orgId);
    const organizations = await this.prisma.organization.findMany({
      where: { id: { in: orgIds }, isActive: true },
      select: {
        id: true,
        name: true,
        slug: true,
        type: true,
        address: true,
      },
    });

    return favorites.map((fav) => ({
      ...fav,
      organization: organizations.find((org) => org.id === fav.orgId),
    }));
  }

  async addFavorite(customerId: string, orgId: string) {
    const org = await this.prisma.organization.findFirst({
      where: { id: orgId, isActive: true },
    });

    if (!org) {
      throw new NotFoundException('Organization not found');
    }

    return this.prisma.customerFavorite.upsert({
      where: { customerId_orgId: { customerId, orgId } },
      create: { customerId, orgId },
      update: {},
    });
  }

  async removeFavorite(customerId: string, orgId: string) {
    await this.prisma.customerFavorite.deleteMany({
      where: { customerId, orgId },
    });
  }

  private async generateTokens(customerId: string) {
    const payload = { sub: customerId, type: 'customer' };

    const accessToken = this.jwtService.sign(payload);

    const refreshToken = this.jwtService.sign(payload, {
      secret: this.configService.get<string>('JWT_REFRESH_SECRET'),
      expiresIn: this.configService.get<string>('JWT_REFRESH_EXPIRATION', '30d'),
    });

    // Store session
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 30);

    await this.prisma.customerSession.create({
      data: {
        customerId,
        refreshToken,
        expiresAt,
      },
    });

    return { accessToken, refreshToken };
  }
}
