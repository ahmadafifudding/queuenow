// Feature: organization-switching, Property 11: Login with no eligible membership is forbidden

import type { ConfigService } from '@nestjs/config';
import type { JwtService } from '@nestjs/jwt';
import type { Prisma, User } from '@queuenow/db';
import { ERROR_CODES } from '@queuenow/shared-constants';
import fc from 'fast-check';

import type { PrismaService } from '../../prisma/prisma.service';
import { AuthForbiddenException } from '../../common/exceptions/auth-forbidden.exception';
import { AuthService } from './auth.service';
import type { LoginDto } from './dto/login.dto';

/**
 * Property 11 — Login with no eligible membership is forbidden.
 * Validates: Requirements 4.6
 *
 * For any user who has zero memberships OR whose every membership belongs to an
 * inactive organization, `AuthService.login` rejects with `AUTH_FORBIDDEN` and
 * issues neither an access nor a refresh token (no JWT is signed and no Session
 * row is created).
 *
 * The method under test is `AuthService.login(dto)`. We construct `AuthService`
 * with mocked `PrismaService`, `JwtService`, and `ConfigService`, mock
 * `prisma.user.findUnique` to return a user with a valid `passwordHash` and a
 * membership set that is either empty or entirely inactive, and stub
 * `bcrypt.compare` to succeed so login reaches the default-membership selection.
 * `selectDefaultMembership` then returns `null`, driving the `AUTH_FORBIDDEN`
 * rejection path before any token is issued.
 */

// `bcrypt.compare` is stubbed to true so the password check passes and login
// proceeds to the eligible-membership selection (the behavior under test).
jest.mock('bcrypt', () => ({
  compare: jest.fn().mockResolvedValue(true),
  hash: jest.fn().mockResolvedValue('hashed-password'),
}));

const NUM_RUNS = 100;

/**
 * One membership (`UserRole`) row with its `Organization` eagerly loaded — the
 * exact shape `login`'s `roles: { include: { org: true } }` query produces.
 */
type MembershipWithOrg = Prisma.UserRoleGetPayload<{ include: { org: true } }>;

/** Minimal spec for a generated membership; only the fields login reads vary. */
interface MembershipSpec {
  orgId: string;
  createdAtMs: number;
  role: 'OWNER' | 'ADMIN' | 'STAFF';
}

/** Builds an inactive-org membership (`org.isActive === false`). */
function buildInactiveMembership(spec: MembershipSpec): MembershipWithOrg {
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
      isActive: false,
      createdAt,
      updatedAt: createdAt,
    },
  };
}

function buildUser(roles: MembershipWithOrg[]): User & { roles: MembershipWithOrg[] } {
  const now = new Date();
  return {
    id: 'user-1',
    email: 'user@example.com',
    passwordHash: '$2b$12$abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUV', // valid bcrypt shape
    fullName: 'Test User',
    phone: null,
    avatarUrl: null,
    emailVerified: true,
    googleId: null,
    lastLoginAt: null,
    createdAt: now,
    updatedAt: now,
    roles,
  } as unknown as User & { roles: MembershipWithOrg[] };
}

const membershipSpec = (): fc.Arbitrary<MembershipSpec> =>
  fc.record({
    orgId: fc.string({ minLength: 1, maxLength: 6 }),
    createdAtMs: fc.integer({ min: 1, max: 5_000 }),
    role: fc.constantFrom<'OWNER' | 'ADMIN' | 'STAFF'>('OWNER', 'ADMIN', 'STAFF'),
  });

/**
 * A membership set that is NOT eligible for login: either empty (zero
 * memberships) or one-to-many memberships that all belong to inactive
 * organizations. Distinct `orgId`s respect the `@@unique(userId, orgId)`
 * constraint; `minLength: 0` exercises the zero-membership case.
 */
const ineligibleMembershipSet = (): fc.Arbitrary<MembershipWithOrg[]> =>
  fc
    .uniqueArray(membershipSpec(), {
      minLength: 0,
      maxLength: 6,
      selector: (spec) => spec.orgId,
    })
    .map((specs) => specs.map(buildInactiveMembership));

interface Harness {
  service: AuthService;
  signSpy: jest.Mock;
  sessionCreate: jest.Mock;
}

function buildHarness(user: User & { roles: MembershipWithOrg[] }): Harness {
  const signSpy = jest.fn().mockReturnValue('signed-token');
  const sessionCreate = jest.fn().mockResolvedValue({ id: 'session-1' });

  const prismaMock = {
    user: {
      findUnique: jest.fn().mockResolvedValue(user),
      update: jest.fn().mockResolvedValue(user),
    },
    session: {
      create: sessionCreate,
    },
  } as unknown as PrismaService;

  const jwtMock = {
    sign: signSpy,
  } as unknown as JwtService;

  const configMock = {
    getOrThrow: jest.fn().mockReturnValue('refresh-secret'),
    get: jest.fn().mockReturnValue('7d'),
  } as unknown as ConfigService;

  return {
    service: new AuthService(prismaMock, jwtMock, configMock),
    signSpy,
    sessionCreate,
  };
}

const loginDto = (): LoginDto =>
  ({ email: 'user@example.com', password: 'correct-password' }) as LoginDto;

describe('Property 11: Login with no eligible membership is forbidden', () => {
  it('rejects with AUTH_FORBIDDEN and issues no tokens or sessions (R4.6)', async () => {
    await fc.assert(
      fc.asyncProperty(ineligibleMembershipSet(), async (memberships) => {
        const { service, signSpy, sessionCreate } = buildHarness(buildUser(memberships));

        const error = await service
          .login(loginDto())
          .then(() => null)
          .catch((e: unknown) => e);

        // Rejected with the AUTH_FORBIDDEN domain exception.
        expect(error).toBeInstanceOf(AuthForbiddenException);
        const response = (error as AuthForbiddenException).getResponse() as { code: string };
        expect(response.code).toBe(ERROR_CODES.AUTH_FORBIDDEN);

        // No access or refresh token signed, and no Session row created.
        expect(signSpy).not.toHaveBeenCalled();
        expect(sessionCreate).not.toHaveBeenCalled();
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('rejects a user with zero memberships (R4.6)', async () => {
    const { service, signSpy, sessionCreate } = buildHarness(buildUser([]));

    await expect(service.login(loginDto())).rejects.toBeInstanceOf(AuthForbiddenException);
    expect(signSpy).not.toHaveBeenCalled();
    expect(sessionCreate).not.toHaveBeenCalled();
  });
});
