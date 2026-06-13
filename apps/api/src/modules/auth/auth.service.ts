import { Injectable, UnauthorizedException, ConflictException } from '@nestjs/common';
import { JwtService, JwtSignOptions } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../../prisma/prisma.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
  ) {}

  async register(dto: RegisterDto) {
    // Check if email already exists
    const existingUser = await this.prisma.user.findUnique({
      where: { email: dto.email },
    });

    if (existingUser) {
      throw new ConflictException('Email already registered');
    }

    // Hash password
    const passwordHash = await bcrypt.hash(dto.password, 12);

    // Create user + organization in a transaction
    const result = await this.prisma.$transaction(async (tx) => {
      // Create user
      const user = await tx.user.create({
        data: {
          email: dto.email,
          passwordHash,
          fullName: dto.fullName,
          phone: dto.phone,
          emailVerified: false,
        },
      });

      // Create organization
      const slug = this.generateSlug(dto.organizationName);
      const organization = await tx.organization.create({
        data: {
          name: dto.organizationName,
          slug,
          type: dto.organizationType,
          ownerId: user.id,
        },
      });

      // Create owner role
      await tx.userRole.create({
        data: {
          userId: user.id,
          orgId: organization.id,
          role: 'OWNER',
        },
      });

      // Create default queue settings
      await tx.queueSettings.create({
        data: {
          orgId: organization.id,
        },
      });

      // Create default branding
      await tx.organizationBranding.create({
        data: {
          orgId: organization.id,
        },
      });

      return { user, organization };
    });

    // Generate tokens
    const tokens = await this.generateTokens(result.user.id, result.organization.id, 'OWNER');

    return {
      user: {
        id: result.user.id,
        email: result.user.email,
        fullName: result.user.fullName,
      },
      organization: {
        id: result.organization.id,
        name: result.organization.name,
        slug: result.organization.slug,
      },
      tokens,
    };
  }

  async login(dto: LoginDto) {
    // Find user
    const user = await this.prisma.user.findUnique({
      where: { email: dto.email },
      include: {
        roles: {
          include: { org: true },
        },
      },
    });

    if (!user || !user.passwordHash) {
      throw new UnauthorizedException('Invalid email or password');
    }

    // Verify password
    const isPasswordValid = await bcrypt.compare(dto.password, user.passwordHash);

    if (!isPasswordValid) {
      throw new UnauthorizedException('Invalid email or password');
    }

    // Update last login
    await this.prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    });

    // Get primary role (first org)
    const primaryRole = user.roles[0];

    if (!primaryRole) {
      throw new UnauthorizedException('No organization assigned');
    }

    // Generate tokens
    const tokens = await this.generateTokens(user.id, primaryRole.orgId, primaryRole.role);

    return {
      user: {
        id: user.id,
        email: user.email,
        fullName: user.fullName,
        avatarUrl: user.avatarUrl,
      },
      organization: {
        id: primaryRole.org.id,
        name: primaryRole.org.name,
        slug: primaryRole.org.slug,
        role: primaryRole.role,
      },
      tokens,
    };
  }

  async refreshToken(refreshToken: string) {
    // Find session
    const session = await this.prisma.session.findUnique({
      where: { refreshToken },
      include: { user: { include: { roles: true } } },
    });

    if (!session || session.expiresAt < new Date()) {
      throw new UnauthorizedException('Invalid or expired refresh token');
    }

    const primaryRole = session.user.roles[0];

    if (!primaryRole) {
      throw new UnauthorizedException('No organization assigned');
    }

    // Delete old session
    await this.prisma.session.delete({ where: { id: session.id } });

    // Generate new tokens
    const tokens = await this.generateTokens(session.user.id, primaryRole.orgId, primaryRole.role);

    return { tokens };
  }

  async logout(refreshToken: string) {
    await this.prisma.session.deleteMany({
      where: { refreshToken },
    });

    return { message: 'Logged out successfully' };
  }

  private async generateTokens(userId: string, orgId: string, role: string) {
    const payload = { sub: userId, orgId, role, type: 'staff' };

    const accessToken = this.jwtService.sign(payload);

    const refreshToken = this.jwtService.sign(payload, {
      secret: this.configService.getOrThrow<string>('JWT_REFRESH_SECRET'),
      expiresIn: this.configService.get<string>('JWT_REFRESH_EXPIRATION', '7d'),
    } as JwtSignOptions);

    // Store refresh token in DB
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 7);

    await this.prisma.session.create({
      data: {
        userId,
        refreshToken,
        expiresAt,
      },
    });

    return { accessToken, refreshToken };
  }

  private generateSlug(name: string): string {
    return name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '');
  }
}
