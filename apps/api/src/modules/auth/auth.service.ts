import { randomUUID } from 'node:crypto';
import { Injectable, UnauthorizedException, ConflictException } from '@nestjs/common';
import { JwtService, JwtSignOptions } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import type { Prisma, User } from '@queuenow/db';
import { UserRoleType } from '@queuenow/shared-types';
import type { ILoginResponse, ITokenPair, OrganizationMembership } from '@queuenow/shared-types';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../../prisma/prisma.service';
import { AuthForbiddenException } from '../../common/exceptions/auth-forbidden.exception';
import { AuthUnauthorizedException } from '../../common/exceptions/auth-unauthorized.exception';
import { OrgInactiveException } from '../../common/exceptions/org-inactive.exception';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';

/**
 * A single membership (`UserRole`) row with its associated `Organization`
 * eagerly loaded, exactly as produced by the
 * `roles: { include: { org: true } }` query used in `login`/`refreshToken`.
 */
type MembershipWithOrg = Prisma.UserRoleGetPayload<{ include: { org: true } }>;

/**
 * The claims encoded in the Refresh_Token JWT payload
 * `{ sub, orgId, role, type: 'staff' }`. Only `orgId` (the persisted record of
 * the Active_Organization, R3.1) is consumed on refresh; `role` is intentionally
 * NOT trusted and is re-read from the current membership instead (R3.3).
 */
interface RefreshTokenClaims {
  sub: string;
  orgId: string;
  role: string;
  type: string;
}

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
        role: 'OWNER',
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

    // Select the deterministic default Active_Organization: the eligible
    // (active) membership with the earliest createdAt, tie-broken by smallest
    // orgId. Replaces the legacy `user.roles[0]` single-org lock. (R4.1–R4.4)
    const membership = this.selectDefaultMembership(user.roles);

    if (!membership) {
      // Zero eligible memberships (none at all, or all inactive). (R4.6)
      throw new AuthForbiddenException('No active organization assigned');
    }

    // Generate tokens scoped to the resolved default org + the user's role
    // there, then return the shared login response shape. (R4.5)
    const tokens = await this.generateTokens(user.id, membership.orgId, membership.role);

    return this.buildLoginResponse(user, membership, tokens);
  }

  async refreshToken(refreshToken: string): Promise<ILoginResponse> {
    // Find the Session backing the presented Refresh_Token, loading the user's
    // memberships so the active org can be re-validated below.
    const session = await this.prisma.session.findUnique({
      where: { refreshToken },
      include: { user: { include: { roles: { include: { org: true } } } } },
    });

    // Missing or expired Session → AUTH_UNAUTHORIZED. (R3.8)
    if (!session || session.expiresAt < new Date()) {
      throw new AuthUnauthorizedException('Invalid or expired refresh token');
    }

    // Read the Active_Organization from the Refresh_Token JWT claim rather than
    // deriving it from `roles[0]` or the Session row (which stores no orgId).
    // A token that fails verification is treated as AUTH_UNAUTHORIZED. (R3.1)
    let claims: RefreshTokenClaims;
    try {
      claims = this.jwtService.verify<RefreshTokenClaims>(refreshToken, {
        secret: this.configService.getOrThrow<string>('JWT_REFRESH_SECRET'),
      });
    } catch {
      throw new AuthUnauthorizedException('Invalid or expired refresh token');
    }

    // Re-validate that the user still has a Membership in the claimed org and
    // that the org is active, applying the fixed check order: membership absent
    // → AUTH_FORBIDDEN (R3.4), then org inactive → ORG_INACTIVE (R3.9). The role
    // is taken from the current membership, NOT the (possibly stale) claims.role
    // (R3.3).
    const membership = this.resolveActiveMembership(session.user.roles, claims.orgId);

    // Rotate the Session: delete the old row before issuing new tokens
    // (generateTokens creates the replacement Session). (R3.7)
    await this.prisma.session.delete({ where: { id: session.id } });

    const tokens = await this.generateTokens(session.user.id, claims.orgId, membership.role);

    // Return the shared login response shape with the preserved active org and
    // the user's current role in it. (R3.5)
    return this.buildLoginResponse(session.user, membership, tokens);
  }

  /**
   * Switches the requesting User's Active_Organization to `targetOrgId`,
   * re-issuing tokens scoped to that organization and the User's role there.
   *
   * Authorization is enforced entirely on the backend (R6.1): the User's
   * memberships are loaded and `resolveActiveMembership` applies the fixed check
   * order — membership absent → `AUTH_FORBIDDEN` (R2.7, R2.8, R7.3), then
   * organization inactive → `ORG_INACTIVE` (R2.9, R7.4) — BEFORE any token is
   * generated or any Session is mutated, so a rejected switch leaves the User's
   * session state untouched (R6.1, R6.2).
   *
   * On success the Session backing the presented Refresh_Token is deleted
   * (R2.5) and `generateTokens` issues a fresh token pair and creates the
   * replacement Session (R2.4). Switching to the already-Active_Organization is
   * a normal switch — it is not special-cased and still rotates the Session
   * (R2.10). The role encoded in the new tokens is read from the User's current
   * membership in the target organization (R2.13, R6.3).
   * (Requirements 2.1, 2.2, 2.4, 2.5, 2.6, 2.7, 2.8, 2.9, 2.10, 2.13, 6.1, 6.2, 6.3)
   */
  async switchOrganization(
    userId: string,
    targetOrgId: string,
    presentedRefreshToken: string,
  ): Promise<ILoginResponse> {
    // Load the user with their memberships (matching the login query shape) so
    // the target organization can be authorized below.
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: {
        roles: {
          include: { org: true },
        },
      },
    });

    if (!user) {
      // An authenticated access token whose user no longer exists is treated as
      // a forbidden switch (no tokens issued). (R2.7, R6.1)
      throw new AuthForbiddenException();
    }

    // Run ALL authorization checks before mutating any session or generating
    // tokens (R6.1): membership absent → AUTH_FORBIDDEN, then org inactive →
    // ORG_INACTIVE (R7.1).
    const membership = this.resolveActiveMembership(user.roles, targetOrgId);

    // Rotate the Session: delete the row backing the presented Refresh_Token
    // (R2.5) before issuing new tokens (generateTokens creates the replacement
    // Session, R2.4).
    await this.prisma.session.deleteMany({
      where: { refreshToken: presentedRefreshToken },
    });

    const tokens = await this.generateTokens(user.id, targetOrgId, membership.role);

    // Return the shared login response shape scoped to the target org and the
    // user's current role there. (R2.2, R2.13)
    return this.buildLoginResponse(user, membership, tokens);
  }

  async logout(refreshToken: string) {
    await this.prisma.session.deleteMany({
      where: { refreshToken },
    });

    return { message: 'Logged out successfully' };
  }

  /**
   * Lists every Organization the User belongs to, projecting each membership to
   * the shared `OrganizationMembership` shape. Inactive organizations are
   * included and distinguished only by `isActive: false`; entries are ordered
   * deterministically by membership `createdAt` ascending, tie-broken by
   * `orgId` ascending, so list order agrees with the default-organization rule.
   * Exactly the single entry whose `id` equals `activeOrgId` is flagged
   * `active: true` (none when no membership matches). A User with no
   * memberships yields an empty list.
   * (Requirements 1.1, 1.2, 1.3, 1.4, 1.5, 1.7, 1.8, 1.10)
   */
  async listOrganizations(userId: string, activeOrgId: string): Promise<OrganizationMembership[]> {
    const memberships = await this.prisma.userRole.findMany({
      where: { userId },
      include: { org: true },
    });

    return [...memberships]
      .sort((a, b) => this.compareMemberships(a, b))
      .map((membership) => ({
        id: membership.org.id,
        name: membership.org.name,
        slug: membership.org.slug,
        isActive: membership.org.isActive,
        role: membership.role as UserRoleType,
        active: membership.org.id === activeOrgId,
      }));
  }

  /**
   * Deterministic membership ordering shared by the list endpoint and the
   * default-organization selection: `createdAt` ascending (earliest first),
   * tie-broken by `orgId` in ascending Unicode code-point order.
   * (Requirements 1.4, 4.1, 4.2)
   */
  private compareMemberships(a: MembershipWithOrg, b: MembershipWithOrg): number {
    const byCreatedAt = a.createdAt.getTime() - b.createdAt.getTime();
    if (byCreatedAt !== 0) {
      return byCreatedAt;
    }
    if (a.orgId < b.orgId) {
      return -1;
    }
    if (a.orgId > b.orgId) {
      return 1;
    }
    return 0;
  }

  /**
   * Selects the deterministic default Active_Organization at login: the
   * eligible membership (organization `isActive === true`) with the earliest
   * `createdAt`, tie-broken by smallest `orgId`. Inactive organizations are
   * never selected even when they have an earlier `createdAt`. Returns `null`
   * when the user has no eligible membership.
   * (Requirements 1.4, 4.1, 4.2, 4.3, 4.4)
   */
  private selectDefaultMembership(memberships: MembershipWithOrg[]): MembershipWithOrg | null {
    const eligible = memberships
      .filter((membership) => membership.org.isActive === true)
      .sort((a, b) => this.compareMemberships(a, b));

    return eligible[0] ?? null;
  }

  /**
   * Resolves the target Membership for a switch or refresh, applying the fixed
   * check order and throwing the appropriate domain exception on the first
   * failure (R7.1):
   *   1. The User has no Membership in `targetOrgId` (or the Organization does
   *      not exist, which is indistinguishable here) → `AuthForbiddenException`
   *      (R2.7, R2.8, R3.4, R7.3).
   *   2. The Membership exists but its Organization's `isActive` is false →
   *      `OrgInactiveException` (R2.9, R3.9, R7.4).
   * Returns the resolved active Membership when both checks pass.
   */
  private resolveActiveMembership(
    memberships: MembershipWithOrg[],
    targetOrgId: string,
  ): MembershipWithOrg {
    const membership = memberships.find((candidate) => candidate.orgId === targetOrgId);

    if (!membership) {
      throw new AuthForbiddenException();
    }

    if (membership.org.isActive === false) {
      throw new OrgInactiveException();
    }

    return membership;
  }

  /**
   * Builds the `ILoginResponse` shared by `login`, `switchOrganization`, and
   * `refreshToken` for a resolved `(user, membership)` pair. The returned
   * `organization` carries the Organization `id`, `name`, `slug`, and the User's
   * `role` in that Organization, and `tokens` is the freshly issued token pair.
   * (Requirements 2.2, 2.13, 3.5)
   */
  private buildLoginResponse(
    user: User,
    membership: MembershipWithOrg,
    tokens: ITokenPair,
  ): ILoginResponse {
    return {
      user: {
        id: user.id,
        email: user.email,
        fullName: user.fullName,
        avatarUrl: user.avatarUrl,
      },
      organization: {
        id: membership.org.id,
        name: membership.org.name,
        slug: membership.org.slug,
        role: membership.role as UserRoleType,
      },
      tokens,
    };
  }

  private async generateTokens(userId: string, orgId: string, role: string) {
    const payload = { sub: userId, orgId, role, type: 'staff', jti: randomUUID() };

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
