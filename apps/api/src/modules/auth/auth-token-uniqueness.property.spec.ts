// Feature: refresh-token-collision, Property 1: same-second issuances for the same (userId, orgId, role) yield distinct refresh tokens with no unique-constraint violation

import type { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import fc from 'fast-check';

import type { PrismaService } from '../../prisma/prisma.service';
import { AuthService } from './auth.service';

/**
 * Property 1 (Bug Condition / Fix Checking) — Unique Refresh Token By
 * Construction.
 *
 * Validates: Requirements 2.1, 2.2, 2.3
 *
 * Property 1: For any pair of token issuances where the bug condition holds
 * (`isBugCondition` true — same `userId`, `orgId`, `role`, and same one-second
 * `iat` bucket), the fixed `generateTokens` SHALL produce two DISTINCT refresh
 * tokens, persist each backing `Session` WITHOUT a unique-constraint violation,
 * and raise no HTTP 500 — so `login`/`register`/`refreshToken`/
 * `switchOrganization` each complete successfully on the second invocation
 * (R2.1, R2.2, R2.3).
 *
 * The method under test is the private `AuthService.generateTokens`, the single
 * source of token issuance and `Session` creation that every token-issuing path
 * funnels through. A REAL `JwtService` is used so the refresh token is actually
 * signed (its only time-varying field on the UNFIXED code is the
 * second-granularity `iat`). `PrismaService` is mocked with an in-memory session
 * store whose `session.create` REJECTS on a duplicate `refreshToken` with a
 * `P2002`-shaped error, mirroring the `@unique Session.refreshToken` column.
 *
 * Scoped PBT approach (deterministic bug): the clock (`Date.now`, the source of
 * the JWT `iat`) is pinned to a single second so both issuances land in the same
 * one-second bucket — `isBugCondition(X)` is forced true. `fast-check` then
 * generates random `(userId, orgId, role)` triples.
 *
 * EXPLORATION TEST (pre-fix): this test is EXPECTED TO FAIL on the UNFIXED code.
 * On the unfixed code the two refresh tokens are byte-identical and the second
 * `session.create` rejects with the simulated unique-constraint (`P2002`) error,
 * confirming the bug. It becomes the fix-checking test that passes once the fix
 * lands (re-run in task 3.2).
 */

const NUM_RUNS = 100;

const ACCESS_SECRET = 'access-secret-for-property-tests';
const REFRESH_SECRET = 'refresh-secret-for-property-tests';

/** A single second, fixed, that both issuances are pinned to (the JWT `iat`). */
const PINNED_NOW_MS = 1_700_000_000_000;

type Role = 'OWNER' | 'ADMIN' | 'STAFF';

interface SessionRow {
  id: string;
  userId: string;
  refreshToken: string;
  expiresAt: Date;
}

/**
 * A `P2002`-shaped error mirroring the Prisma unique-constraint violation
 * Prisma throws when `Session.refreshToken` (a `@unique` column) collides.
 */
class P2002Error extends Error {
  readonly code = 'P2002';
  readonly meta: { target: string[] };

  constructor() {
    super('Unique constraint failed on the fields: (`refreshToken`)');
    this.name = 'PrismaClientKnownRequestError';
    this.meta = { target: ['refreshToken'] };
  }
}

/**
 * In-memory `PrismaService` double whose `session.create` enforces
 * `refreshToken` uniqueness exactly like the `@unique` column: inserting a row
 * whose `refreshToken` already exists rejects with a `P2002`-shaped error.
 */
function createPrismaMock(): {
  prisma: PrismaService;
  sessions: SessionRow[];
  createSpy: jest.Mock;
} {
  const sessions: SessionRow[] = [];
  let counter = 0;

  const createSpy = jest.fn(
    async ({ data }: { data: { userId: string; refreshToken: string; expiresAt: Date } }) => {
      // Mirror the @unique Session.refreshToken column.
      if (sessions.some((s) => s.refreshToken === data.refreshToken)) {
        throw new P2002Error();
      }
      const row: SessionRow = { id: `session-${counter++}`, ...data };
      sessions.push(row);
      return row;
    },
  );

  const prisma = {
    session: {
      create: createSpy,
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

/**
 * Typed accessor for the private `generateTokens` method — the single source of
 * issuance whose fix-checking property is being exercised directly (per the
 * design Fix-Checking pseudocode). Avoids `any` by narrowing through `unknown`.
 */
type TokenPair = { accessToken: string; refreshToken: string };
function generateTokensOf(
  service: AuthService,
): (userId: string, orgId: string, role: string) => Promise<TokenPair> {
  const accessor = service as unknown as {
    generateTokens(userId: string, orgId: string, role: string): Promise<TokenPair>;
  };
  return accessor.generateTokens.bind(service);
}

const role = (): fc.Arbitrary<Role> => fc.constantFrom<Role>('OWNER', 'ADMIN', 'STAFF');

/** A random identity triple — the `(userId, orgId, role)` both issuances share. */
const identity = (): fc.Arbitrary<{ userId: string; orgId: string; role: Role }> =>
  fc.record({
    userId: fc.uuid(),
    orgId: fc.uuid(),
    role: role(),
  });

describe('Property 1: Bug Condition - Unique Refresh Token By Construction', () => {
  let nowSpy: jest.SpyInstance<number, []>;

  beforeAll(() => {
    // Pin Date.now (the source of the JWT `iat`, seconds granularity) so both
    // issuances fall in the same one-second bucket — forcing isBugCondition.
    nowSpy = jest.spyOn(Date, 'now').mockReturnValue(PINNED_NOW_MS);
  });

  afterAll(() => {
    nowSpy.mockRestore();
  });

  it('two same-second issuances for the same (userId, orgId, role) yield distinct refresh tokens and persist both Sessions with no unique-constraint violation (R2.1, R2.2, R2.3)', async () => {
    await fc.assert(
      fc.asyncProperty(identity(), async ({ userId, orgId, role: r }) => {
        const { prisma, sessions } = createPrismaMock();
        const service = new AuthService(prisma, createJwtService(), createConfigService());
        const generateTokens = generateTokensOf(service);

        // First issuance succeeds and persists its backing Session.
        const firstResult = await generateTokens(userId, orgId, r);

        // Second issuance for the SAME identity within the SAME pinned second.
        // Expected Behavior: distinct refresh token, both Sessions persist, and
        // NO unique-constraint violation / HTTP 500 is raised.
        const secondResult = await generateTokens(userId, orgId, r);

        expect(secondResult.refreshToken).not.toBe(firstResult.refreshToken);
        expect(sessions).toHaveLength(2);
      }),
      { numRuns: NUM_RUNS },
    );
  });
});

// Feature: refresh-token-collision, Property 2: for non-colliding inputs the refresh verify path, JwtStrategy claims, session creation, and response shape are unchanged

/**
 * Property 2 (Preservation) — Verification And Claims Unchanged.
 *
 * Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.5
 *
 * Property 2: For any input where the bug condition does NOT hold
 * (`isBugCondition` false), the fixed `generateTokens` SHALL produce the same
 * externally observable contract as the original — the refresh verify path
 * still reads `{ sub, orgId, role }` (R3.1), `JwtStrategy` still reads
 * `{ sub, orgId, role, type }` from the access-token claim (R3.2), non-colliding
 * issuances still create a backing `Session` and return the token-pair shape
 * (R3.3), `prisma.session.create` is still called once per issuance with
 * `{ userId, refreshToken, expiresAt }` (R3.4), and the response shape is
 * unchanged (R3.5).
 *
 * OBSERVATION-FIRST METHODOLOGY (pre-fix): these tests run on the UNFIXED code
 * over the `NOT isBugCondition(X)` domain — issuances that differ in identity
 * (`userId`/`orgId`/`role`) OR fall in different one-second `iat` buckets — and
 * encode the observed baseline contract. They are EXPECTED TO PASS on the
 * unfixed code; this is the behavior the `jti` fix must preserve.
 *
 * The clock (`Date.now`, the source of the JWT `iat`) is controllable so that a
 * generated pair can be placed either in the same second (when identities
 * differ) or in different one-second buckets (when identities match) — either
 * way guaranteeing `NOT isBugCondition`.
 */

interface AccessClaims {
  sub: string;
  orgId: string;
  role: string;
  type: string;
}

/**
 * Mirror of the private `RefreshTokenClaims` interface in `auth.service.ts`
 * (`{ sub, orgId, role, type }`) — the claim shape the `refreshToken` verify
 * path reads. Declared locally because the production interface is not exported.
 */
interface RefreshTokenClaimsShape {
  sub: string;
  orgId: string;
  role: string;
  type: string;
}

/** floor(ms / 1000) — the one-second `iat` bucket a JWT signed at `ms` lands in. */
function iatBucket(ms: number): number {
  return Math.floor(ms / 1000);
}

/**
 * Faithful port of the design's `isBugCondition`: two issuances collide only
 * when they share `(userId, orgId, role)` AND fall in the same one-second `iat`
 * bucket.
 */
function isBugCondition(
  a: { userId: string; orgId: string; role: Role; atMs: number },
  b: { userId: string; orgId: string; role: Role; atMs: number },
): boolean {
  return (
    a.userId === b.userId &&
    a.orgId === b.orgId &&
    a.role === b.role &&
    iatBucket(a.atMs) === iatBucket(b.atMs)
  );
}

/**
 * A non-colliding pair of issuances (`NOT isBugCondition`). Two shapes are
 * generated:
 *   - distinct identities issued in the SAME one-second bucket (non-colliding
 *     because the signed payloads differ), and
 *   - the SAME identity issued in DIFFERENT one-second buckets (non-colliding
 *     because the `iat` differs).
 * `advanceMs` is how far the clock moves between the first and second issuance.
 */
const nonCollidingPair = (): fc.Arbitrary<{
  first: { userId: string; orgId: string; role: Role };
  second: { userId: string; orgId: string; role: Role };
  advanceMs: number;
}> =>
  fc.oneof(
    // Different identities, same one-second bucket (advanceMs < 1000).
    fc.record({
      first: identity(),
      second: identity(),
      advanceMs: fc.integer({ min: 0, max: 999 }),
    }),
    // Same identity, different one-second buckets (advanceMs >= 1000).
    identity().chain((id) =>
      fc.record({
        first: fc.constant(id),
        second: fc.constant(id),
        advanceMs: fc.integer({ min: 1000, max: 120_000 }),
      }),
    ),
  );

describe('Property 2: Preservation - Verification And Claims Unchanged', () => {
  let currentNowMs = PINNED_NOW_MS;
  let nowSpy: jest.SpyInstance<number, []>;

  beforeAll(() => {
    // Controllable clock so a pair can be placed in the same or different
    // one-second buckets (the source of the JWT `iat`).
    nowSpy = jest.spyOn(Date, 'now').mockImplementation(() => currentNowMs);
  });

  beforeEach(() => {
    currentNowMs = PINNED_NOW_MS;
  });

  afterAll(() => {
    nowSpy.mockRestore();
  });

  const refreshSecretOpts = { secret: REFRESH_SECRET };

  it('refresh verify-path reads { sub, orgId, role } from the issued refresh token (R3.1)', async () => {
    await fc.assert(
      fc.asyncProperty(identity(), async ({ userId, orgId, role: r }) => {
        const { prisma } = createPrismaMock();
        const jwt = createJwtService();
        const service = new AuthService(prisma, jwt, createConfigService());
        const { refreshToken } = await generateTokensOf(service)(userId, orgId, r);

        // Verifying with JWT_REFRESH_SECRET reads the claims exactly as the
        // refreshToken path does (RefreshTokenClaims).
        const claims = jwt.verify<RefreshTokenClaimsShape>(refreshToken, refreshSecretOpts);

        expect(claims.sub).toBe(userId);
        expect(claims.orgId).toBe(orgId);
        expect(claims.role).toBe(r);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('access token carries { sub, orgId, role, type } readable by JwtStrategy (R3.2)', async () => {
    await fc.assert(
      fc.asyncProperty(identity(), async ({ userId, orgId, role: r }) => {
        const { prisma } = createPrismaMock();
        const jwt = createJwtService();
        const service = new AuthService(prisma, jwt, createConfigService());
        const { accessToken } = await generateTokensOf(service)(userId, orgId, r);

        // The access token is signed with the default (access) secret and is
        // verified the same way JwtStrategy consumes it.
        const claims = jwt.verify<AccessClaims>(accessToken);

        expect(claims.sub).toBe(userId);
        expect(claims.orgId).toBe(orgId);
        expect(claims.role).toBe(r);
        expect(claims.type).toBe('staff');
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('each non-colliding issuance creates a backing Session and returns the token-pair shape (R3.3, R3.5)', async () => {
    await fc.assert(
      fc.asyncProperty(nonCollidingPair(), async ({ first, second, advanceMs }) => {
        const firstAt = { ...first, atMs: PINNED_NOW_MS };
        const secondAt = { ...second, atMs: PINNED_NOW_MS + advanceMs };
        // Only exercise the NOT isBugCondition domain.
        fc.pre(!isBugCondition(firstAt, secondAt));

        const { prisma, sessions } = createPrismaMock();
        const service = new AuthService(prisma, createJwtService(), createConfigService());
        const generateTokens = generateTokensOf(service);

        currentNowMs = firstAt.atMs;
        const firstResult = await generateTokens(first.userId, first.orgId, first.role);

        currentNowMs = secondAt.atMs;
        const secondResult = await generateTokens(second.userId, second.orgId, second.role);

        // Token-pair shape preserved for both issuances (R3.5).
        for (const result of [firstResult, secondResult]) {
          expect(typeof result.accessToken).toBe('string');
          expect(typeof result.refreshToken).toBe('string');
          expect(Object.keys(result).sort()).toEqual(['accessToken', 'refreshToken']);
        }

        // Both non-colliding issuances persisted a backing Session (R3.3).
        expect(sessions).toHaveLength(2);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('prisma.session.create is called once per issuance with { userId, refreshToken, expiresAt } (R3.4)', async () => {
    await fc.assert(
      fc.asyncProperty(identity(), async ({ userId, orgId, role: r }) => {
        const { prisma, createSpy } = createPrismaMock();
        const service = new AuthService(prisma, createJwtService(), createConfigService());
        const result = await generateTokensOf(service)(userId, orgId, r);

        // Single source of issuance: exactly one Session created per issuance.
        expect(createSpy).toHaveBeenCalledTimes(1);

        const createArg = createSpy.mock.calls[0][0] as {
          data: { userId: string; refreshToken: string; expiresAt: Date };
        };
        expect(createArg.data.userId).toBe(userId);
        expect(createArg.data.refreshToken).toBe(result.refreshToken);
        expect(createArg.data.expiresAt).toBeInstanceOf(Date);
      }),
      { numRuns: NUM_RUNS },
    );
  });
});
