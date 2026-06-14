// Feature: organization-switching, Property 5: Issued token claims reflect target/active org and current role
//
// This spec also covers:
//   Property 6  — Session rotation on switch and refresh
//   Property 7  — Membership authorization (forbidden) on switch and refresh
//   Property 8  — Inactive organization rejection on switch and refresh
//   Property 12 — No side effects on rejection
//   Property 13 — Check ordering: membership is evaluated before active status
//
// Validates: Requirements 2.1, 2.2, 2.4, 2.5, 2.7, 2.8, 2.9, 2.13, 3.3, 3.4, 3.5, 4.5, 6.1, 6.2, 6.3, 7.1, 7.3, 7.4
//
// The methods under test are `AuthService.switchOrganization` and
// `AuthService.refreshToken`. A REAL `JwtService` is used so the issued access
// and refresh tokens can be decoded and their `{ sub, orgId, role, type }`
// claims asserted. `PrismaService` is mocked with a per-scenario tracker so we
// can assert session rotation (old session deleted + exactly one new created)
// and no-side-effects-on-rejection (no `session.create`, presented session left
// intact). `auth.service.ts` is NOT modified.

import { JwtService } from '@nestjs/jwt';
import type { ConfigService } from '@nestjs/config';
import type { Prisma } from '@queuenow/db';
import { ERROR_CODES } from '@queuenow/shared-constants';
import fc from 'fast-check';

import type { PrismaService } from '../../prisma/prisma.service';
import { AuthService } from './auth.service';

const NUM_RUNS = 100;

const ACCESS_SECRET = 'test-access-secret';
const REFRESH_SECRET = 'test-refresh-secret';

type Role = 'OWNER' | 'ADMIN' | 'STAFF';

/** One membership (`UserRole`) row with its `Organization` eagerly loaded. */
type MembershipWithOrg = Prisma.UserRoleGetPayload<{ include: { org: true } }>;

/** The claim shape encoded in both access and refresh JWTs. */
interface DecodedClaims {
  sub: string;
  orgId: string;
  role: string;
  type: string;
}

interface MemberSpec {
  orgId: string;
  role: Role;
  isActive: boolean;
  createdAtMs: number;
}

// ---------------------------------------------------------------------------
// Builders
// ---------------------------------------------------------------------------

function buildMembership(spec: MemberSpec): MembershipWithOrg {
  const createdAt = new Date(spec.createdAtMs);
  return {
    id: `role-${spec.orgId}`,
    userId: 'user-1',
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
      ownerId: 'user-1',
      timezone: 'Asia/Kuala_Lumpur',
      isActive: spec.isActive,
      createdAt,
      updatedAt: createdAt,
    },
  } as MembershipWithOrg;
}

interface MockUser {
  id: string;
  email: string;
  fullName: string;
  avatarUrl: string | null;
  passwordHash: string;
  roles: MembershipWithOrg[];
}

function buildUser(userId: string, memberships: MembershipWithOrg[]): MockUser {
  return {
    id: userId,
    email: `${userId}@example.com`,
    fullName: `User ${userId}`,
    avatarUrl: null,
    passwordHash: 'hash',
    roles: memberships.map((m) => ({ ...m, userId })),
  };
}

// ---------------------------------------------------------------------------
// Mock PrismaService with a call tracker
// ---------------------------------------------------------------------------

interface PrismaTracker {
  sessionCreateCalls: Array<{ userId: string; refreshToken: string; expiresAt: Date }>;
  sessionDeleteManyCalls: Array<{ refreshToken: string }>;
  sessionDeleteCalls: Array<{ id: string }>;
}

interface SessionRow {
  id: string;
  userId: string;
  refreshToken: string;
  expiresAt: Date;
  user: MockUser;
}

function createTracker(): PrismaTracker {
  return { sessionCreateCalls: [], sessionDeleteManyCalls: [], sessionDeleteCalls: [] };
}

/** Builds a mocked `PrismaService` for the `switchOrganization` flow. */
function createSwitchPrisma(user: MockUser | null, tracker: PrismaTracker): PrismaService {
  return {
    user: {
      findUnique: async (): Promise<MockUser | null> => user,
    },
    session: {
      deleteMany: async ({ where }: { where: { refreshToken: string } }) => {
        tracker.sessionDeleteManyCalls.push({ refreshToken: where.refreshToken });
        return { count: 1 };
      },
      create: async ({
        data,
      }: {
        data: { userId: string; refreshToken: string; expiresAt: Date };
      }) => {
        tracker.sessionCreateCalls.push(data);
        return { id: 'new-session', ...data };
      },
    },
  } as unknown as PrismaService;
}

/** Builds a mocked `PrismaService` for the `refreshToken` flow. */
function createRefreshPrisma(session: SessionRow | null, tracker: PrismaTracker): PrismaService {
  return {
    session: {
      findUnique: async (): Promise<SessionRow | null> => session,
      delete: async ({ where }: { where: { id: string } }) => {
        tracker.sessionDeleteCalls.push({ id: where.id });
        return {};
      },
      create: async ({
        data,
      }: {
        data: { userId: string; refreshToken: string; expiresAt: Date };
      }) => {
        tracker.sessionCreateCalls.push(data);
        return { id: 'new-session', ...data };
      },
    },
  } as unknown as PrismaService;
}

function createConfig(): ConfigService {
  return {
    getOrThrow: (key: string): string => {
      if (key === 'JWT_REFRESH_SECRET') {
        return REFRESH_SECRET;
      }
      if (key === 'JWT_ACCESS_SECRET') {
        return ACCESS_SECRET;
      }
      throw new Error(`Unexpected config key: ${key}`);
    },
    get: (_key: string, defaultValue?: string): string | undefined => defaultValue,
  } as unknown as ConfigService;
}

function createJwt(): JwtService {
  return new JwtService({ secret: ACCESS_SECRET, signOptions: { expiresIn: '15m' } });
}

function makeService(prisma: PrismaService): { service: AuthService; jwt: JwtService } {
  const jwt = createJwt();
  const service = new AuthService(prisma, jwt, createConfig());
  return { service, jwt };
}

function decode(jwt: JwtService, token: string): DecodedClaims {
  return jwt.decode(token) as DecodedClaims;
}

/** Reads the `{ code }` carried by a thrown domain `HttpException`. */
function errorCode(error: unknown): string | undefined {
  const response = (error as { getResponse?: () => unknown }).getResponse?.();
  if (response && typeof response === 'object' && 'code' in response) {
    return (response as { code?: string }).code;
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Arbitraries
// ---------------------------------------------------------------------------

const roleArb = fc.constantFrom<Role>('OWNER', 'ADMIN', 'STAFF');
const orgIdArb = fc.uuid();

/** A set of memberships with unique orgIds (the `@@unique([userId, orgId])` rule). */
function memberSetArb(options: {
  minLength: number;
  forceActive?: boolean;
}): fc.Arbitrary<MemberSpec[]> {
  return fc.uniqueArray(
    fc.record({
      orgId: orgIdArb,
      role: roleArb,
      isActive: options.forceActive === true ? fc.constant(true) : fc.boolean(),
      createdAtMs: fc.integer({ min: 1_000, max: 9_000 }),
    }),
    { selector: (s) => s.orgId, minLength: options.minLength, maxLength: 6 },
  );
}

// ---------------------------------------------------------------------------
// Property 5 + 6: successful switch — claims reflect target/role, session rotates
// ---------------------------------------------------------------------------

describe('Property 5 & 6: switchOrganization issues correct claims and rotates the session', () => {
  it('encodes target orgId + current role into both tokens and returns the matching organization (R2.1, R2.2, R2.13, R4.5, R6.3)', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.uuid(),
        memberSetArb({ minLength: 1, forceActive: true }),
        fc.integer({ min: 0, max: 5 }),
        fc.string({ minLength: 1 }),
        async (userId, members, targetSeed, presentedRefreshToken) => {
          const memberships = members.map(buildMembership);
          const target = memberships[targetSeed % memberships.length];
          const user = buildUser(userId, memberships);
          const tracker = createTracker();
          const { service, jwt } = makeService(createSwitchPrisma(user, tracker));

          const result = await service.switchOrganization(
            userId,
            target.orgId,
            presentedRefreshToken,
          );

          const access = decode(jwt, result.tokens.accessToken);
          const refresh = decode(jwt, result.tokens.refreshToken);

          // P5 — both tokens carry the target org + the user's role there.
          for (const claims of [access, refresh]) {
            expect(claims.sub).toBe(userId);
            expect(claims.orgId).toBe(target.orgId);
            expect(claims.role).toBe(target.role);
            expect(claims.type).toBe('staff');
          }

          // P5 — returned organization object matches the target membership.
          expect(result.organization.id).toBe(target.orgId);
          expect(result.organization.role).toBe(target.role);
          expect(result.organization.name).toBe(target.org.name);
          expect(result.organization.slug).toBe(target.org.slug);

          // P6 — presented session deleted, exactly one new session created.
          expect(tracker.sessionDeleteManyCalls).toEqual([{ refreshToken: presentedRefreshToken }]);
          expect(tracker.sessionCreateCalls).toHaveLength(1);
          expect(tracker.sessionCreateCalls[0]?.refreshToken).toBe(result.tokens.refreshToken);
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });
});

// ---------------------------------------------------------------------------
// Property 5 + 6: successful refresh — role refreshed from current membership
// ---------------------------------------------------------------------------

describe('Property 5 & 6: refreshToken preserves org and refreshes the role from the current membership', () => {
  it('issues tokens whose orgId = refresh-claim org and role = CURRENT membership role even when the presented claim role is stale (R3.3, R3.5)', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.uuid(),
        memberSetArb({ minLength: 1, forceActive: true }),
        fc.integer({ min: 0, max: 5 }),
        roleArb,
        async (userId, members, targetSeed, staleRole) => {
          const memberships = members.map(buildMembership);
          const active = memberships[targetSeed % memberships.length];
          const user = buildUser(userId, memberships);
          const tracker = createTracker();
          const prismaSessionUser = user;

          const jwt = createJwt();
          // The presented refresh token carries a possibly-stale role claim.
          const presentedRefreshToken = jwt.sign(
            { sub: userId, orgId: active.orgId, role: staleRole, type: 'staff' },
            { secret: REFRESH_SECRET, expiresIn: '7d' },
          );
          const session: SessionRow = {
            id: 'session-1',
            userId,
            refreshToken: presentedRefreshToken,
            expiresAt: new Date(Date.now() + 60_000),
            user: prismaSessionUser,
          };
          const service = new AuthService(
            createRefreshPrisma(session, tracker),
            jwt,
            createConfig(),
          );

          const result = await service.refreshToken(presentedRefreshToken);

          const accessClaims = decode(jwt, result.tokens.accessToken);
          const refreshClaims = decode(jwt, result.tokens.refreshToken);

          for (const claims of [accessClaims, refreshClaims]) {
            expect(claims.orgId).toBe(active.orgId);
            // Role comes from the CURRENT membership, never the stale claim.
            expect(claims.role).toBe(active.role);
            expect(claims.type).toBe('staff');
          }
          expect(result.organization.id).toBe(active.orgId);
          expect(result.organization.role).toBe(active.role);

          // P6 — old session deleted, exactly one new session created.
          expect(tracker.sessionDeleteCalls).toEqual([{ id: 'session-1' }]);
          expect(tracker.sessionCreateCalls).toHaveLength(1);
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });
});

// ---------------------------------------------------------------------------
// Property 7 + 12: forbidden on non-membership, no side effects
// ---------------------------------------------------------------------------

describe('Property 7 & 12: switchOrganization rejects non-members with AUTH_FORBIDDEN and no side effects', () => {
  it('throws AUTH_FORBIDDEN, issues no tokens, and leaves the presented session intact (R2.7, R2.8, R6.1, R6.2, R7.3)', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.uuid(),
        memberSetArb({ minLength: 0 }),
        orgIdArb,
        fc.string({ minLength: 1 }),
        async (userId, members, targetOrgId, presentedRefreshToken) => {
          // Ensure the target is NOT one of the user's memberships.
          fc.pre(!members.some((m) => m.orgId === targetOrgId));

          const memberships = members.map(buildMembership);
          const user = buildUser(userId, memberships);
          const tracker = createTracker();
          const { service } = makeService(createSwitchPrisma(user, tracker));

          let thrown: unknown;
          try {
            await service.switchOrganization(userId, targetOrgId, presentedRefreshToken);
          } catch (error) {
            thrown = error;
          }

          expect(thrown).toBeDefined();
          expect(errorCode(thrown)).toBe(ERROR_CODES.AUTH_FORBIDDEN);
          // P12 — no session mutated on rejection.
          expect(tracker.sessionCreateCalls).toHaveLength(0);
          expect(tracker.sessionDeleteManyCalls).toHaveLength(0);
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });
});

describe('Property 7 & 12: refreshToken rejects lost memberships with AUTH_FORBIDDEN and no side effects', () => {
  it('throws AUTH_FORBIDDEN when the user no longer has a membership in the claim org, with the presented session left intact (R3.4, R6.2)', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.uuid(),
        memberSetArb({ minLength: 0 }),
        orgIdArb,
        roleArb,
        async (userId, members, claimOrgId, claimRole) => {
          fc.pre(!members.some((m) => m.orgId === claimOrgId));

          const memberships = members.map(buildMembership);
          const user = buildUser(userId, memberships);
          const tracker = createTracker();
          const jwt = createJwt();
          const presentedRefreshToken = jwt.sign(
            { sub: userId, orgId: claimOrgId, role: claimRole, type: 'staff' },
            { secret: REFRESH_SECRET, expiresIn: '7d' },
          );
          const session: SessionRow = {
            id: 'session-1',
            userId,
            refreshToken: presentedRefreshToken,
            expiresAt: new Date(Date.now() + 60_000),
            user,
          };
          const service = new AuthService(
            createRefreshPrisma(session, tracker),
            jwt,
            createConfig(),
          );

          let thrown: unknown;
          try {
            await service.refreshToken(presentedRefreshToken);
          } catch (error) {
            thrown = error;
          }

          expect(thrown).toBeDefined();
          expect(errorCode(thrown)).toBe(ERROR_CODES.AUTH_FORBIDDEN);
          // P12 — presented session not deleted, no new session created.
          expect(tracker.sessionDeleteCalls).toHaveLength(0);
          expect(tracker.sessionCreateCalls).toHaveLength(0);
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });
});

// ---------------------------------------------------------------------------
// Property 8 + 12: inactive organization rejection
// ---------------------------------------------------------------------------

describe('Property 8 & 12: inactive organization rejection on switch and refresh', () => {
  it('switchOrganization to a member-but-inactive org throws ORG_INACTIVE with no side effects (R2.9, R7.4)', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.uuid(),
        orgIdArb,
        roleArb,
        memberSetArb({ minLength: 0 }),
        fc.string({ minLength: 1 }),
        async (userId, targetOrgId, targetRole, otherMembers, presentedRefreshToken) => {
          // The target is a membership whose org is inactive; other members get distinct ids.
          const others = otherMembers.filter((m) => m.orgId !== targetOrgId);
          const memberships = [
            buildMembership({
              orgId: targetOrgId,
              role: targetRole,
              isActive: false,
              createdAtMs: 1_000,
            }),
            ...others.map(buildMembership),
          ];
          const user = buildUser(userId, memberships);
          const tracker = createTracker();
          const { service } = makeService(createSwitchPrisma(user, tracker));

          let thrown: unknown;
          try {
            await service.switchOrganization(userId, targetOrgId, presentedRefreshToken);
          } catch (error) {
            thrown = error;
          }

          expect(thrown).toBeDefined();
          expect(errorCode(thrown)).toBe(ERROR_CODES.ORG_INACTIVE);
          expect(tracker.sessionCreateCalls).toHaveLength(0);
          expect(tracker.sessionDeleteManyCalls).toHaveLength(0);
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  it('refreshToken with a member-but-inactive claim org throws ORG_INACTIVE with no side effects (R3.9, R7.4)', async () => {
    await fc.assert(
      fc.asyncProperty(fc.uuid(), orgIdArb, roleArb, async (userId, claimOrgId, claimRole) => {
        const memberships = [
          buildMembership({
            orgId: claimOrgId,
            role: claimRole,
            isActive: false,
            createdAtMs: 1_000,
          }),
        ];
        const user = buildUser(userId, memberships);
        const tracker = createTracker();
        const jwt = createJwt();
        const presentedRefreshToken = jwt.sign(
          { sub: userId, orgId: claimOrgId, role: claimRole, type: 'staff' },
          { secret: REFRESH_SECRET, expiresIn: '7d' },
        );
        const session: SessionRow = {
          id: 'session-1',
          userId,
          refreshToken: presentedRefreshToken,
          expiresAt: new Date(Date.now() + 60_000),
          user,
        };
        const service = new AuthService(createRefreshPrisma(session, tracker), jwt, createConfig());

        let thrown: unknown;
        try {
          await service.refreshToken(presentedRefreshToken);
        } catch (error) {
          thrown = error;
        }

        expect(thrown).toBeDefined();
        expect(errorCode(thrown)).toBe(ERROR_CODES.ORG_INACTIVE);
        expect(tracker.sessionDeleteCalls).toHaveLength(0);
        expect(tracker.sessionCreateCalls).toHaveLength(0);
      }),
      { numRuns: NUM_RUNS },
    );
  });
});

// ---------------------------------------------------------------------------
// Property 13: membership checked before active status
// ---------------------------------------------------------------------------

describe('Property 13: switchOrganization checks membership before active status', () => {
  it('a non-member target yields AUTH_FORBIDDEN (never ORG_INACTIVE) even when other memberships are inactive (R7.1)', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.uuid(),
        // Existing memberships are ALL inactive, so the only thing distinguishing
        // the non-member target is membership absence — it must lose to AUTH_FORBIDDEN.
        memberSetArb({ minLength: 1 }),
        orgIdArb,
        fc.string({ minLength: 1 }),
        async (userId, members, targetOrgId, presentedRefreshToken) => {
          fc.pre(!members.some((m) => m.orgId === targetOrgId));

          const memberships = members.map((m) => buildMembership({ ...m, isActive: false }));
          const user = buildUser(userId, memberships);
          const tracker = createTracker();
          const { service } = makeService(createSwitchPrisma(user, tracker));

          let thrown: unknown;
          try {
            await service.switchOrganization(userId, targetOrgId, presentedRefreshToken);
          } catch (error) {
            thrown = error;
          }

          expect(errorCode(thrown)).toBe(ERROR_CODES.AUTH_FORBIDDEN);
          expect(errorCode(thrown)).not.toBe(ERROR_CODES.ORG_INACTIVE);
          expect(tracker.sessionCreateCalls).toHaveLength(0);
          expect(tracker.sessionDeleteManyCalls).toHaveLength(0);
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });
});
