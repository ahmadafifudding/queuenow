import {
  Injectable,
  NotFoundException,
  UnauthorizedException,
  ConflictException,
} from '@nestjs/common';
import { JwtService, JwtSignOptions } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import type { ICustomerLoginResponse } from '@queuenow/shared-types';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../../prisma/prisma.service';
import { AuthUnauthorizedException } from '../../common/exceptions/auth-unauthorized.exception';
import { AuthTokenExpiredException } from '../../common/exceptions/auth-token-expired.exception';

/**
 * Claims encoded in the customer Refresh_Token JWT, signed by
 * {@link CustomerService.generateTokens} as `{ sub, type: 'customer' }`.
 */
interface CustomerRefreshClaims {
  sub: string;
  type: string;
}

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
        OR: [{ email: dto.email }, { phone: dto.phone }].filter(
          (c) => Object.values(c)[0] !== undefined,
        ),
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

  /**
   * Rotates a customer session from a presented Refresh_Token (held in mobile
   * secure storage and sent in the request body, R12.2). Verifies the refresh
   * JWT against `JWT_REFRESH_SECRET`, validates the backing `CustomerSession`,
   * deletes that session, and issues a fresh token pair via `generateTokens`
   * (which persists the replacement session). Returns the same shape as login
   * (`ICustomerLoginResponse`).
   *
   * - Expired refresh JWT or expired session → `AUTH_TOKEN_EXPIRED`.
   * - Malformed/unknown token, no backing session, or claim mismatch →
   *   `AUTH_UNAUTHORIZED`.
   *
   * Either way the mobile client clears its tokens and routes to sign-in (R12.4).
   */
  async refreshToken(refreshToken: string): Promise<ICustomerLoginResponse> {
    // 1. Verify the refresh JWT signature/expiry against JWT_REFRESH_SECRET
    //    (the secret CustomerService.generateTokens signs refresh tokens with).
    let claims: CustomerRefreshClaims;
    try {
      claims = this.jwtService.verify<CustomerRefreshClaims>(refreshToken, {
        secret: this.configService.getOrThrow<string>('JWT_REFRESH_SECRET'),
      });
    } catch (error) {
      if (error instanceof Error && error.name === 'TokenExpiredError') {
        throw new AuthTokenExpiredException('Refresh token has expired');
      }
      throw new AuthUnauthorizedException('Invalid or expired refresh token');
    }

    // 2. A customer refresh token must carry the customer token type.
    if (claims.type !== 'customer') {
      throw new AuthUnauthorizedException('Invalid or expired refresh token');
    }

    // 3. Find the CustomerSession backing the presented token, loading the
    //    customer so the response can mirror the login shape.
    const session = await this.prisma.customerSession.findUnique({
      where: { refreshToken },
      include: { customer: true },
    });

    // No backing session (e.g. already rotated/revoked) or claim mismatch →
    // unauthorized.
    if (!session || session.customerId !== claims.sub) {
      throw new AuthUnauthorizedException('Invalid or expired refresh token');
    }

    // Expired session → token-expired so the client re-authenticates. Clean up
    // the stale row before bailing out.
    if (session.expiresAt < new Date()) {
      await this.prisma.customerSession.delete({ where: { id: session.id } });
      throw new AuthTokenExpiredException('Refresh token has expired');
    }

    // 4. Rotate the session: delete the old row before issuing the new pair
    //    (generateTokens creates the replacement CustomerSession).
    await this.prisma.customerSession.delete({ where: { id: session.id } });

    const tokens = await this.generateTokens(session.customerId);

    return {
      customer: {
        id: session.customer.id,
        email: session.customer.email,
        phone: session.customer.phone,
        fullName: session.customer.fullName,
        avatarUrl: session.customer.avatarUrl,
      },
      tokens,
    };
  }

  private async generateTokens(customerId: string) {
    const payload = { sub: customerId, type: 'customer' };

    const accessToken = this.jwtService.sign(payload);

    const refreshToken = this.jwtService.sign(payload, {
      secret: this.configService.getOrThrow<string>('JWT_REFRESH_SECRET'),
      expiresIn: this.configService.get<string>('JWT_REFRESH_EXPIRATION', '30d'),
    } as JwtSignOptions);

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
