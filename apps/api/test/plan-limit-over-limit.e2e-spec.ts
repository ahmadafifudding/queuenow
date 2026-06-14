/**
 * Task 12.2 — Direct-API over-limit Supertest.
 *
 * Validates Requirement 10.7: a direct API call (no UI) that attempts to create
 * an over-limit resource returns the standard error envelope with
 * `error.code === 'PLAN_LIMIT_EXCEEDED'` and HTTP status 403.
 *
 * This runs against a REAL Postgres database. When no `DATABASE_URL` is
 * configured the whole suite is skipped so it degrades gracefully without a DB.
 */
import { INestApplication } from '@nestjs/common';
import request from 'supertest';

import { ERROR_CODES, PLAN_LIMITS } from '@queuenow/shared-constants';

import { PrismaService } from '../src/prisma/prisma.service';
import {
  API_PREFIX,
  cleanupTestOrg,
  createE2EApp,
  isDatabaseAvailable,
  registerTestOwner,
  setOrgPlan,
  TestOwner,
} from './utils/e2e-app';

const describeWithDb = isDatabaseAvailable() ? describe : describe.skip;

describeWithDb('Plan limit enforcement — direct-API over-limit (R10.7)', () => {
  // FREE plan ⇒ maxServices = 1, so a second service is over the limit.
  const PLAN = 'FREE' as const;
  const LIMIT = PLAN_LIMITS[PLAN].maxServices;

  let app: INestApplication;
  let prisma: PrismaService;
  let owner: TestOwner;

  beforeAll(async () => {
    const ctx = await createE2EApp();
    app = ctx.app;
    prisma = ctx.prisma;
    owner = await registerTestOwner(app);
    await setOrgPlan(prisma, owner.orgId, PLAN);
  });

  afterAll(async () => {
    if (prisma && owner) {
      await cleanupTestOrg(prisma, owner);
    }
    if (app) {
      await app.close();
    }
  });

  it('returns PLAN_LIMIT_EXCEEDED with HTTP 403 when creating an over-limit resource', async () => {
    const limit = LIMIT as number;
    expect(typeof limit).toBe('number');
    const server = app.getHttpServer();

    // Fill the org up to its limit (FREE ⇒ 1 service). These succeed.
    for (let i = 0; i < limit; i += 1) {
      await request(server)
        .post(`/${API_PREFIX}/organizations/${owner.orgId}/services`)
        .set('Authorization', `Bearer ${owner.accessToken}`)
        .send({ name: `Allowed Service ${i}`, prefix: `A${i}` })
        .expect(201);
    }

    // The next create is over the limit and must be rejected.
    const response = await request(server)
      .post(`/${API_PREFIX}/organizations/${owner.orgId}/services`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({ name: 'Over Limit Service', prefix: 'OVR' });

    expect(response.status).toBe(403);
    expect(response.body.success).toBe(false);
    expect(response.body.error.code).toBe(ERROR_CODES.PLAN_LIMIT_EXCEEDED);
    expect(typeof response.body.error.message).toBe('string');
    expect(response.body.error.message.length).toBeGreaterThan(0);
    expect(response.body.error.details).toMatchObject({
      limitName: 'maxServices',
      limit,
      currentUsage: limit,
      plan: PLAN,
    });

    // The rejection left usage unchanged — still exactly `limit` services.
    const finalCount = await prisma.service.count({ where: { orgId: owner.orgId } });
    expect(finalCount).toBe(limit);
  });
});
