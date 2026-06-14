/**
 * Task 9.1 — Organization switching e2e (real Postgres).
 *
 * Exercises the REAL NestJS application wired to a REAL Postgres database
 * (no mocked Prisma) over real HTTP via Supertest. When no `DATABASE_URL`
 * is configured the whole suite is skipped so it degrades gracefully.
 *
 * Coverage:
 * - GET  /auth/organizations          → envelope shape, ordering, active flag (R1.6, R1.4, R1.5)
 * - POST /auth/switch-organization    → refresh_token cookie attributes + body omits
 *                                        refreshToken (R2.3); session rotation (R2.4, R2.5);
 *                                        new access token authorizes the new org (R6.4)
 * - anonymous requests to both routes → 401 AUTH_UNAUTHORIZED (R1.9, R2.11, R7.2)
 * - malformed switch body             → 400 VALIDATION_ERROR (R2.12)
 * - error envelope                    → no stack/internal details leaked (R7.5)
 */
import { INestApplication } from '@nestjs/common';
import request from 'supertest';

import { OrganizationType, UserRoleType } from '@queuenow/db';
import { ERROR_CODES } from '@queuenow/shared-constants';

import { PrismaService } from '../src/prisma/prisma.service';
import {
  API_PREFIX,
  TEST_OWNER_PASSWORD,
  cleanupTestOrg,
  createE2EApp,
  isDatabaseAvailable,
  registerTestOwner,
  TestOwner,
} from './utils/e2e-app';

const describeWithDb = isDatabaseAvailable() ? describe : describe.skip;

/** One organization-membership entry as returned by GET /auth/organizations. */
interface OrganizationMembershipBody {
  id: string;
  name: string;
  slug: string;
  isActive: boolean;
  role: UserRoleType;
  active: boolean;
}

interface ListOrganizationsBody {
  success: boolean;
  data: OrganizationMembershipBody[];
  meta?: unknown;
}

interface SwitchOrganizationBody {
  success: boolean;
  data: {
    user: { id: string; email: string };
    organization: { id: string; name: string; slug: string; role: UserRoleType };
    tokens: { accessToken: string; refreshToken?: unknown };
  };
}

interface ErrorBody {
  success: boolean;
  error: { code: string; message: string; details?: unknown };
}

interface LoginResult {
  accessToken: string;
  /** `refresh_token=<value>` pair suitable for the `Cookie` request header. */
  cookiePair: string;
  /** The raw refresh-token JWT value (matches the persisted Session row). */
  refreshToken: string;
}

/** Extract the `refresh_token` Set-Cookie string from a Supertest response. */
function getRefreshSetCookie(headers: Record<string, unknown>): string {
  const raw = headers['set-cookie'];
  const cookies: string[] = Array.isArray(raw) ? (raw as string[]) : raw ? [String(raw)] : [];
  const refresh = cookies.find((c) => c.startsWith('refresh_token='));
  if (refresh === undefined) {
    throw new Error('Expected a refresh_token Set-Cookie header but none was present');
  }
  return refresh;
}

/** `refresh_token=abc; Path=/...; HttpOnly` → `refresh_token=abc`. */
function toCookiePair(setCookie: string): string {
  const [pair] = setCookie.split(';');
  return pair ?? setCookie;
}

/** `refresh_token=abc; ...` → `abc`. */
function toCookieValue(setCookie: string): string {
  return toCookiePair(setCookie).slice('refresh_token='.length);
}

describeWithDb(
  'Organization switching e2e (R1.6, R2.3, R2.4, R2.5, R2.11, R2.12, R7.2, R7.5)',
  () => {
    let app: INestApplication;
    let prisma: PrismaService;
    let owner: TestOwner;
    let secondOrgId: string;

    /** Log the test owner in over real HTTP, capturing a fresh refresh cookie. */
    async function loginOwner(): Promise<LoginResult> {
      const res = await request(app.getHttpServer())
        .post(`/${API_PREFIX}/auth/login`)
        .send({ email: owner.email, password: TEST_OWNER_PASSWORD })
        .expect(200);

      const setCookie = getRefreshSetCookie(res.headers as Record<string, unknown>);
      const body = res.body as SwitchOrganizationBody;

      return {
        accessToken: body.data.tokens.accessToken,
        cookiePair: toCookiePair(setCookie),
        refreshToken: toCookieValue(setCookie),
      };
    }

    beforeAll(async () => {
      const ctx = await createE2EApp();
      app = ctx.app;
      prisma = ctx.prisma;

      // Register an owner — this creates the FIRST organization + an OWNER
      // membership (the deterministic default org at login).
      owner = await registerTestOwner(app);

      // Create a SECOND organization owned by the same user, plus an ADMIN
      // membership, so the user is genuinely multi-org. Its membership
      // `createdAt` is later than the first, fixing the list ordering.
      const unique = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
      const secondOrg = await prisma.organization.create({
        data: {
          name: `Org Switch E2E Second ${unique}`,
          slug: `org-switch-e2e-second-${unique}`,
          type: OrganizationType.CLINIC,
          ownerId: owner.userId,
          isActive: true,
        },
      });
      secondOrgId = secondOrg.id;

      await prisma.userRole.create({
        data: {
          userId: owner.userId,
          orgId: secondOrgId,
          role: UserRoleType.ADMIN,
        },
      });
    });

    afterAll(async () => {
      if (prisma && secondOrgId) {
        await prisma.organization.deleteMany({ where: { id: secondOrgId } });
      }
      if (prisma && owner) {
        await cleanupTestOrg(prisma, owner);
      }
      if (app) {
        await app.close();
      }
    });

    it('GET /auth/organizations returns the standard envelope, ordered, with the active flag (R1.6, R1.4, R1.5)', async () => {
      const res = await request(app.getHttpServer())
        .get(`/${API_PREFIX}/auth/organizations`)
        .set('Authorization', `Bearer ${owner.accessToken}`)
        .expect(200);

      const body = res.body as ListOrganizationsBody;

      // Standard success envelope (R1.6). `meta` is optional in the shared
      // envelope and omitted when empty, so we assert the success + data shape.
      expect(body.success).toBe(true);
      expect(Array.isArray(body.data)).toBe(true);

      // Exactly the two memberships are returned.
      expect(body.data).toHaveLength(2);

      // Ordered by membership createdAt ascending — the register org first,
      // the later-created second org next (R1.4).
      const first = body.data[0];
      const second = body.data[1];
      if (first === undefined || second === undefined) {
        throw new Error('Expected two organization entries');
      }
      expect(first.id).toBe(owner.orgId);
      expect(second.id).toBe(secondOrgId);

      // Each entry carries the projected fields (R1.2, R1.3).
      for (const entry of body.data) {
        expect(typeof entry.id).toBe('string');
        expect(typeof entry.name).toBe('string');
        expect(typeof entry.slug).toBe('string');
        expect(typeof entry.isActive).toBe('boolean');
        expect(typeof entry.role).toBe('string');
        expect(typeof entry.active).toBe('boolean');
      }
      expect(second.role).toBe(UserRoleType.ADMIN);
      expect(second.isActive).toBe(true);

      // Exactly the entry matching the presented access-token orgId is active (R1.5).
      expect(first.active).toBe(true);
      expect(second.active).toBe(false);
    });

    it('POST /auth/switch-organization sets the refresh_token cookie attributes and omits refreshToken from the body (R2.3)', async () => {
      const session = await loginOwner();

      const res = await request(app.getHttpServer())
        .post(`/${API_PREFIX}/auth/switch-organization`)
        .set('Authorization', `Bearer ${session.accessToken}`)
        .set('Cookie', session.cookiePair)
        .send({ orgId: secondOrgId })
        .expect(200);

      const setCookie = getRefreshSetCookie(res.headers as Record<string, unknown>);

      // httpOnly, SameSite=Lax, scoped to the /api/v1/auth path (R2.3).
      expect(setCookie).toMatch(/HttpOnly/i);
      expect(setCookie).toMatch(/SameSite=Lax/i);
      expect(setCookie).toMatch(/Path=\/api\/v1\/auth/i);

      const body = res.body as SwitchOrganizationBody;

      // The body carries the access token but never the refresh token (R2.3).
      expect(typeof body.data.tokens.accessToken).toBe('string');
      expect(body.data.tokens.accessToken.length).toBeGreaterThan(0);
      expect(body.data.tokens).not.toHaveProperty('refreshToken');

      // Tokens are scoped to the target org and the user's role there (R2.2).
      expect(body.data.organization.id).toBe(secondOrgId);
      expect(body.data.organization.role).toBe(UserRoleType.ADMIN);
    });

    it('rotates the Session on switch: the presented refresh token is gone and a new one exists (R2.4, R2.5)', async () => {
      const session = await loginOwner();

      // Sanity: the presented refresh token has a backing Session before the switch.
      const before = await prisma.session.findUnique({
        where: { refreshToken: session.refreshToken },
      });
      expect(before).not.toBeNull();

      const res = await request(app.getHttpServer())
        .post(`/${API_PREFIX}/auth/switch-organization`)
        .set('Authorization', `Bearer ${session.accessToken}`)
        .set('Cookie', session.cookiePair)
        .send({ orgId: secondOrgId })
        .expect(200);

      const newRefreshToken = toCookieValue(
        getRefreshSetCookie(res.headers as Record<string, unknown>),
      );

      // The presented session was deleted (R2.5)…
      const oldSession = await prisma.session.findUnique({
        where: { refreshToken: session.refreshToken },
      });
      expect(oldSession).toBeNull();

      // …and a brand-new session backs the freshly issued refresh token (R2.4).
      expect(newRefreshToken).not.toBe(session.refreshToken);
      const newSession = await prisma.session.findUnique({
        where: { refreshToken: newRefreshToken },
      });
      expect(newSession).not.toBeNull();
      expect(newSession?.userId).toBe(owner.userId);
    });

    it('authorizes subsequent requests using the new token: the second org is now active (R6.4)', async () => {
      const session = await loginOwner();

      const switchRes = await request(app.getHttpServer())
        .post(`/${API_PREFIX}/auth/switch-organization`)
        .set('Authorization', `Bearer ${session.accessToken}`)
        .set('Cookie', session.cookiePair)
        .send({ orgId: secondOrgId })
        .expect(200);

      const newAccessToken = (switchRes.body as SwitchOrganizationBody).data.tokens.accessToken;

      const listRes = await request(app.getHttpServer())
        .get(`/${API_PREFIX}/auth/organizations`)
        .set('Authorization', `Bearer ${newAccessToken}`)
        .expect(200);

      const data = (listRes.body as ListOrganizationsBody).data;
      const firstEntry = data.find((e) => e.id === owner.orgId);
      const secondEntry = data.find((e) => e.id === secondOrgId);

      expect(secondEntry?.active).toBe(true);
      expect(firstEntry?.active).toBe(false);
    });

    it('rejects anonymous requests to both endpoints with 401 AUTH_UNAUTHORIZED (R1.9, R2.11, R7.2)', async () => {
      const listRes = await request(app.getHttpServer())
        .get(`/${API_PREFIX}/auth/organizations`)
        .expect(401);
      const listBody = listRes.body as ErrorBody;
      expect(listBody.success).toBe(false);
      expect(listBody.error.code).toBe(ERROR_CODES.AUTH_UNAUTHORIZED);

      const switchRes = await request(app.getHttpServer())
        .post(`/${API_PREFIX}/auth/switch-organization`)
        .send({ orgId: secondOrgId })
        .expect(401);
      const switchBody = switchRes.body as ErrorBody;
      expect(switchBody.success).toBe(false);
      expect(switchBody.error.code).toBe(ERROR_CODES.AUTH_UNAUTHORIZED);
    });

    it('rejects a malformed switch body with 400 VALIDATION_ERROR (R2.12)', async () => {
      // Non-UUID orgId.
      const invalidRes = await request(app.getHttpServer())
        .post(`/${API_PREFIX}/auth/switch-organization`)
        .set('Authorization', `Bearer ${owner.accessToken}`)
        .send({ orgId: 'not-a-valid-uuid' })
        .expect(400);
      const invalidBody = invalidRes.body as ErrorBody;
      expect(invalidBody.success).toBe(false);
      expect(invalidBody.error.code).toBe(ERROR_CODES.VALIDATION_ERROR);

      // Missing orgId entirely.
      const missingRes = await request(app.getHttpServer())
        .post(`/${API_PREFIX}/auth/switch-organization`)
        .set('Authorization', `Bearer ${owner.accessToken}`)
        .send({})
        .expect(400);
      const missingBody = missingRes.body as ErrorBody;
      expect(missingBody.success).toBe(false);
      expect(missingBody.error.code).toBe(ERROR_CODES.VALIDATION_ERROR);
    });

    it('returns the standard error envelope without leaking stack traces or internal details (R7.5)', async () => {
      // A switch to a well-formed but non-member org id yields AUTH_FORBIDDEN.
      const session = await loginOwner();
      const nonMemberOrgId = '00000000-0000-4000-8000-000000000000';

      const res = await request(app.getHttpServer())
        .post(`/${API_PREFIX}/auth/switch-organization`)
        .set('Authorization', `Bearer ${session.accessToken}`)
        .set('Cookie', session.cookiePair)
        .send({ orgId: nonMemberOrgId })
        .expect(403);

      const body = res.body as ErrorBody;
      expect(body.success).toBe(false);
      expect(body.error.code).toBe(ERROR_CODES.AUTH_FORBIDDEN);
      expect(typeof body.error.message).toBe('string');
      expect(body.error.message.length).toBeGreaterThan(0);

      // No stack trace / internal exception detail leaks anywhere in the envelope (R7.5).
      const serialized = JSON.stringify(body);
      expect(serialized.toLowerCase()).not.toContain('stack');
      expect(serialized).not.toContain('node_modules');
      expect(serialized).not.toMatch(/\.ts:\d+/);
    });
  },
);
