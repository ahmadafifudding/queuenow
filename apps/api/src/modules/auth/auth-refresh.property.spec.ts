// Feature: organization-switching, Property 9: Switch → refresh round-trip organization consistency
// (Property 10: Refresh error conditions is covered in this file too.)

import type { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import type { Prisma, User } from '@queuenow/db';
import fc from 'fast-check';

import type { PrismaService } from '../../prisma/prisma.service';
import { AuthUnauthorizedException } from '../../common/exceptions/auth-unauthorized.exception';
import { AuthService } from './auth.service';

/**
 * Properties 9 & 10 — refresh round-trip consistency and refresh error
 * conditions.
 *
 * Validates: Requirements 3.1, 3.2, 3.6, 3.8
 *
 * Property 9: For all sequences of a successful `switchOrganization(target)`
 * followed by a `refreshToken` using the refresh token that switch produced,
 * the `orgId` returned by the refresh equals `target` — the active organization
 * established by the most recent successful switch is preserved across refresh
 * (R3.1, R3.2, R3.6).
 *
 * Property 10: For any refresh attempt whose presented refresh token has no
 * matching `Session` row or whose `Session` is expired, `refreshToken` rejects
 * with `AUTH_UNAUTHORIZED` and issues no tokens (R3.8).
 *
 * The methods under test are `AuthService.switchOrganization` and
 * `AuthService.refreshToken`. A REAL `JwtService` is used so that
 * `generateTokens` signs the refresh token and `refreshToken` can verify and
 * read its `orgId` claim. `PrismaService` is mocked with a small in-memory
 * session store so the session created by `switchOrganization` (via
 * `generateTokens` → `prisma.session.create`) is found by the subsequent
 * `refreshToken`'s `prisma.session.findUnique({ where: { refreshToken } })`.
 */

const NUM_RUNS = 100;

const ACCESS_SECRET = 'access-secret-for-property-tests';
const REFRESH_SECRET = 'refresh-secret-for-property-tests';

/**
 * One membership (`UserRole`) row with its `Organization` eagerly loaded —
 * matching the `roles: { include: { org: true } }` query shape consumed by
 * `switchOrganization`/`refreshToken`.
 */
type MembershipWithOrg = Prisma.UserRoleGetPayload<{ include: { org: true } }>;

type UserWithRoles = User & { roles: MembershipWithOrg[] };

type Role = 'OWNER' | 'ADMIN' | 'STAFF';

interface MembershipSpec {
  orgId: string;
  role: Role;
  createdAtMs: number;
  isActive: boolean;
}

interface SessionRow {
  id: string;
  userId: string;
  refreshToken: string;
  expiresAt: Date;
}

const USER_ID = 'user-under-test';

function buildUser(specs: MembershipSpec[]): UserWithRoles {
  const baseDate = new Date(0);
  const roles: MembershipWithOrg[] = specs.map((spec) => {
    const createdAt = new Date(spec.createdAtMs);
    return {
      id: `role-${spec.orgId}`,
      userId: USER_ID,
      orgId: spec.orgId,
      role: spec.role,
      assignedServiceId: null,
      createdAt,
      org: {
        id: spec.orgId,
        name: `Org ${spec.orgId}`,
        slug: `org-${spec.orgId}`,
        type: 'CLINIC',
        address: null,
        phone: null,
        email: null,
        plan: 'FREE',
        ownerId: USER_ID,
        timezone: 'Asia/Kuala_Lumpur',
        isActive: spec.isActive,
        createdAt,
        updatedAt: createdAt,
      },
    };
  });

  return {
    id: USER_ID,
    email: 'user@example.com',
    passwordHash: 'hashed',
    fullName: 'Test User',
    phone: null,
    avatarUrl: null,
    emailVerified: true,
    googleId: null,
    lastLoginAt: null,
    createdAt: baseDate,
    updatedAt: baseDate,
    roles,
  } as unknown as UserWithRoles;
}

/**
 * In-memory `PrismaService` double backing `switchOrganization`/`refreshToken`.
 * The `session` store is shared across both calls in a round-trip so the
 * session created during a switch is discoverable by the following refresh.
 */
function createPrismaMock(user: UserWithRoles): {
  prisma: PrismaService;
  sessions: SessionRow[];
  createSpy: jest.Mock;
} {
  const sessions: SessionRow[] = [];
  let counter = 0;

  const createSpy = jest.fn(
    async ({ data }: { data: { userId: string; refreshToken: string; expiresAt: Date } }) => {
      const row: SessionRow = { id: `session-${counter++}`, ...data };
      sessions.push(row);
      return row;
    },
  );

  const prisma = {
    user: {
      findUnique: jest.fn(async ({ where }: { where: { id?: string } }) =>
        where.id === user.id ? user : null,
      ),
      update: jest.fn(async () => user),
    },
    session: {
      findUnique: jest.fn(async ({ where }: { where: { refreshToken?: string; id?: string } }) => {
        const row = sessions.find(
          (s) =>
            (where.refreshToken !== undefined && s.refreshToken === where.refreshToken) ||
            (where.id !== undefined && s.id === where.id),
        );
        return row ? { ...row, user } : null;
      }),
      create: createSpy,
      delete: jest.fn(async ({ where }: { where: { id: string } }) => {
        const idx = sessions.findIndex((s) => s.id === where.id);
        if (idx >= 0) {
          sessions.splice(idx, 1);
        }
        return {};
      }),
      deleteMany: jest.fn(async ({ where }: { where: { refreshToken: string } }) => {
        const before = sessions.length;
        for (let i = sessions.length - 1; i >= 0; i -= 1) {
          if (sessions[i].refreshToken === where.refreshToken) {
            sessions.splice(i, 1);
          }
        }
        return { count: before - sessions.length };
      }),
    },
  } as unknown as PrismaService;

  return { prisma, sessions, createSpy };
}

function createConfigService(): ConfigService {
  const values: Record<string, string> = {
    JWT_REFRESH_SECRET: REFRESH_SECRET,
    JWT_REFRESH_EXPIRATION: '7d',
  };
  return {
    getOrThrow: (key: string): string => {
      const value = values[key];
      if (value === undefined) {
        throw new Error(`Missing config: ${key}`);
      }
      return value;
    },
    get: (key: string, defaultValue?: string): string | undefined => values[key] ?? defaultValue,
  } as unknown as ConfigService;
}

function createJwtService(): JwtService {
  return new JwtService({ secret: ACCESS_SECRET, signOptions: { expiresIn: '15m' } });
}

const role = (): fc.Arbitrary<Role> => fc.constantFrom<Role>('OWNER', 'ADMIN', 'STAFF');

/**
 * A user with two-or-more distinct, ACTIVE memberships plus a chosen switch
 * target drawn from those memberships — the precondition for a successful
 * switch → refresh round-trip.
 */
const multiOrgUserWithTarget = (): fc.Arbitrary<{
  specs: MembershipSpec[];
  target: string;
}> =>
  fc
    .uniqueArray(
      fc.record({
        orgId: fc.uuid(),
        role: role(),
        createdAtMs: fc.integer({ min: 1, max: 10_000_000 }),
      }),
      { minLength: 2, maxLength: 6, selector: (spec) => spec.orgId },
    )
    .chain((entries) =>
      fc.record({
        specs: fc.constant(entries.map((entry) => ({ ...entry, isActive: true }))),
        target: fc.constantFrom(...entries.map((entry) => entry.orgId)),
      }),
    );

describe('Property 9: Switch → refresh round-trip organization consistency', () => {
  it('preserves the switched-to org across refresh: refresh orgId === switch target (R3.1, R3.2, R3.6)', async () => {
    await fc.assert(
      fc.asyncProperty(multiOrgUserWithTarget(), async ({ specs, target }) => {
        const user = buildUser(specs);
        const { prisma } = createPrismaMock(user);
        const jwtService = createJwtService();
        const service = new AuthService(prisma, jwtService, createConfigService());

        // Switch to the chosen target organization.
        const switched = await service.switchOrganization(USER_ID, target, 'presented-refresh');
        expect(switched.organization.id).toBe(target);

        // Refresh using the refresh token the switch produced.
        const refreshed = await service.refreshToken(switched.tokens.refreshToken);

        // The refresh must preserve the switched-to org (not revert to default).
        expect(refreshed.organization.id).toBe(target);

        // The orgId claim signed into the new refresh token must also equal target.
        const claims = jwtService.verify<{ orgId: string }>(refreshed.tokens.refreshToken, {
          secret: REFRESH_SECRET,
        });
        expect(claims.orgId).toBe(target);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('preserves the target across repeated refreshes (round-trip is stable, R3.6)', async () => {
    await fc.assert(
      fc.asyncProperty(
        multiOrgUserWithTarget(),
        fc.integer({ min: 1, max: 4 }),
        async ({ specs, target }, refreshCount) => {
          const user = buildUser(specs);
          const { prisma } = createPrismaMock(user);
          const service = new AuthService(prisma, createJwtService(), createConfigService());

          const switched = await service.switchOrganization(USER_ID, target, 'presented-refresh');
          let currentRefreshToken = switched.tokens.refreshToken;

          for (let i = 0; i < refreshCount; i += 1) {
            const refreshed = await service.refreshToken(currentRefreshToken);
            expect(refreshed.organization.id).toBe(target);
            currentRefreshToken = refreshed.tokens.refreshToken;
          }
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });
});

describe('Property 10: Refresh error conditions', () => {
  it('rejects AUTH_UNAUTHORIZED and issues no tokens when no Session matches (R3.8)', async () => {
    await fc.assert(
      fc.asyncProperty(
        multiOrgUserWithTarget(),
        fc.string({ minLength: 1, maxLength: 40 }),
        async ({ specs }, orphanToken) => {
          const user = buildUser(specs);
          const { prisma, sessions, createSpy } = createPrismaMock(user);
          const service = new AuthService(prisma, createJwtService(), createConfigService());

          // The session store is empty, so no Session backs `orphanToken`.
          await expect(service.refreshToken(orphanToken)).rejects.toBeInstanceOf(
            AuthUnauthorizedException,
          );

          // No new tokens/sessions were issued.
          expect(createSpy).not.toHaveBeenCalled();
          expect(sessions).toHaveLength(0);
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  it('rejects AUTH_UNAUTHORIZED and issues no tokens when the Session is expired (R3.8)', async () => {
    await fc.assert(
      fc.asyncProperty(
        multiOrgUserWithTarget(),
        fc.string({ minLength: 1, maxLength: 40 }),
        fc.integer({ min: 1_000, max: 10_000_000 }),
        async ({ specs }, expiredToken, agoMs) => {
          const user = buildUser(specs);
          const { prisma, sessions, createSpy } = createPrismaMock(user);
          const service = new AuthService(prisma, createJwtService(), createConfigService());

          // Seed an EXPIRED session for the presented refresh token.
          sessions.push({
            id: 'expired-session',
            userId: USER_ID,
            refreshToken: expiredToken,
            expiresAt: new Date(Date.now() - agoMs),
          });

          await expect(service.refreshToken(expiredToken)).rejects.toBeInstanceOf(
            AuthUnauthorizedException,
          );

          // No new session created and the expired one is left intact (no side effects).
          expect(createSpy).not.toHaveBeenCalled();
          expect(sessions).toHaveLength(1);
          expect(sessions[0].id).toBe('expired-session');
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  it('surfaces the AUTH_UNAUTHORIZED error code on the rejection (R3.8)', async () => {
    const user = buildUser([
      {
        orgId: 'a1b2c3d4-0000-4000-8000-000000000001',
        role: 'OWNER',
        createdAtMs: 1,
        isActive: true,
      },
    ]);
    const { prisma } = createPrismaMock(user);
    const service = new AuthService(prisma, createJwtService(), createConfigService());

    try {
      await service.refreshToken('no-such-token');
      throw new Error('expected refreshToken to reject');
    } catch (error) {
      expect(error).toBeInstanceOf(AuthUnauthorizedException);
      const response = (error as AuthUnauthorizedException).getResponse() as { code: string };
      expect(response.code).toBe('AUTH_UNAUTHORIZED');
    }
  });
});
