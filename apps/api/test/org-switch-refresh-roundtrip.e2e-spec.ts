/**
 * Task 9.2 — Switch → refresh round-trip e2e (R3.6 headline guarantee).
 *
 * Validates Requirements 3.1, 3.2, 3.6 end-to-end against a REAL Postgres
 * database: after a user switches to a second organization, performing
 * `POST /auth/refresh` with the refresh cookie that the switch issued returns
 * tokens scoped to the switched-to organization — NOT the deterministic default
 * org selected at login. This proves the active org is read from the
 * refresh-token JWT claim (R3.1) and preserved across refresh (R3.2, R3.6),
 * fixing the single-org lock bug.
 *
 * The flow uses only real HTTP:
 *   1. register an owner (creates the default org + OWNER membership)
 *   2. create a second org + an ADMIN membership for the same user via Prisma
 *   3. login to capture a matched access token + refresh cookie
 *   4. switch to the second org (Bearer access + refresh cookie), capturing the
 *      NEW refresh_token Set-Cookie
 *   5. refresh presenting that new refresh cookie and assert the refreshed
 *      `organization.id` equals the second org (not the default)
 *
 * When no `DATABASE_URL` is configured the whole suite is skipped so it degrades
 * gracefully without a database.
 */
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';

import { PrismaService } from '../src/prisma/prisma.service';
import {
  API_PREFIX,
  cleanupTestOrg,
  createE2EApp,
  isDatabaseAvailable,
  registerTestOwner,
  type TestOwner,
} from './utils/e2e-app';

const describeWithDb = isDatabaseAvailable() ? describe : describe.skip;

const REFRESH_COOKIE_NAME = 'refresh_token';
const OWNER_PASSWORD = 'SecurePassword123!';

interface OrganizationResponse {
  id: string;
  name: string;
  slug: string;
  role: string;
}

interface AuthResponseBody {
  success: boolean;
  data: {
    user: { id: string; email: string; fullName: string };
    organization: OrganizationResponse;
    tokens: { accessToken: string };
  };
}

/**
 * Pull the `refresh_token` cookie's `name=value` pair out of a `Set-Cookie`
 * response header so it can be replayed as a `Cookie` request header (attributes
 * such as Path/HttpOnly/SameSite are intentionally dropped).
 */
function extractRefreshCookie(setCookieHeader: string[] | undefined): string {
  const cookies = setCookieHeader ?? [];
  const refreshCookie = cookies.find((cookie) => cookie.startsWith(`${REFRESH_COOKIE_NAME}=`));
  if (!refreshCookie) {
    throw new Error('Expected a refresh_token cookie to be set');
  }
  const [nameValuePair] = refreshCookie.split(';');
  if (nameValuePair === undefined || nameValuePair.length === 0) {
    throw new Error('Expected a non-empty refresh_token cookie value');
  }
  return nameValuePair;
}

describeWithDb('Organization switching — switch → refresh round-trip (R3.6)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let owner: TestOwner;
  let secondOrgId: string;

  beforeAll(async () => {
    const ctx = await createE2EApp();
    app = ctx.app;
    prisma = ctx.prisma;

    // 1. Register an owner — this creates the default org + OWNER membership.
    owner = await registerTestOwner(app);

    // 2. Create a second org + ADMIN membership for the SAME user via Prisma.
    //    Created after registration, so the default-org rule (earliest
    //    createdAt) still selects the registration org at login.
    const unique = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    const secondOrg = await prisma.organization.create({
      data: {
        name: `Org Switch Roundtrip Second Org ${unique}`,
        slug: `org-switch-roundtrip-${unique}`,
        type: 'CLINIC',
        ownerId: owner.userId,
        isActive: true,
      },
    });
    secondOrgId = secondOrg.id;

    await prisma.userRole.create({
      data: {
        userId: owner.userId,
        orgId: secondOrgId,
        role: 'ADMIN',
      },
    });
  });

  afterAll(async () => {
    // The dedicated second org is not covered by cleanupTestOrg(owner); remove
    // it (cascades its membership) before tearing down the registration org and
    // user. Best-effort so teardown never masks an assertion failure.
    if (prisma && secondOrgId) {
      try {
        await prisma.organization.deleteMany({ where: { id: secondOrgId } });
      } catch {
        // ignore — teardown is best-effort
      }
    }
    if (prisma && owner) {
      await cleanupTestOrg(prisma, owner);
    }
    if (app) {
      await app.close();
    }
  });

  it('refresh after a switch returns the switched-to org, not the login default', async () => {
    const server = app.getHttpServer();

    // 3. Login to capture a matched access token + refresh cookie. Login selects
    //    the deterministic default org (the registration org, NOT the second).
    const loginResponse = await request(server)
      .post(`/${API_PREFIX}/auth/login`)
      .send({ email: owner.email, password: OWNER_PASSWORD })
      .expect(200);

    const loginBody = loginResponse.body as AuthResponseBody;
    expect(loginBody.data.organization.id).toBe(owner.orgId);
    expect(loginBody.data.organization.id).not.toBe(secondOrgId);

    const loginAccessToken = loginBody.data.tokens.accessToken;
    const loginRefreshCookie = extractRefreshCookie(
      loginResponse.headers['set-cookie'] as string[] | undefined,
    );

    // 4. Switch to the second org (Bearer access + refresh cookie). Capture the
    //    NEW refresh_token Set-Cookie — the switch rotates the session.
    const switchResponse = await request(server)
      .post(`/${API_PREFIX}/auth/switch-organization`)
      .set('Authorization', `Bearer ${loginAccessToken}`)
      .set('Cookie', loginRefreshCookie)
      .send({ orgId: secondOrgId })
      .expect(200);

    const switchBody = switchResponse.body as AuthResponseBody;
    expect(switchBody.success).toBe(true);
    expect(switchBody.data.organization.id).toBe(secondOrgId);
    expect(switchBody.data.organization.role).toBe('ADMIN');

    const switchRefreshCookie = extractRefreshCookie(
      switchResponse.headers['set-cookie'] as string[] | undefined,
    );

    // 5. Refresh presenting the NEW refresh cookie. The refreshed org must equal
    //    the switched-to org (R3.6 round-trip), not the login default (R3.1/R3.2).
    const refreshResponse = await request(server)
      .post(`/${API_PREFIX}/auth/refresh`)
      .set('Cookie', switchRefreshCookie)
      .expect(200);

    const refreshBody = refreshResponse.body as AuthResponseBody;
    expect(refreshBody.success).toBe(true);
    expect(refreshBody.data.organization.id).toBe(secondOrgId);
    expect(refreshBody.data.organization.id).not.toBe(owner.orgId);
    expect(refreshBody.data.organization.role).toBe('ADMIN');
  });
});
