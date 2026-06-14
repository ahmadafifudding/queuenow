// Feature: plan-limit-enforcement, Property 2: Usage never exceeds the limit and rejects leave usage unchanged
/**
 * Task 12.1 — Real-database concurrency integration test.
 *
 * Validates Requirement 1.6: when several create requests for the same resource
 * of the same organization race while `currentUsage = limit - 1`, the atomic
 * `Serializable` check-then-create guarantees that the committed usage never
 * exceeds the numeric limit and every excess request is rejected with
 * `PLAN_LIMIT_EXCEEDED` (HTTP 403).
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

describeWithDb('Plan limit enforcement — real-DB concurrency (R1.6)', () => {
  // BASIC plan ⇒ maxServices = 3 — a small, finite numeric limit to race against.
  const PLAN = 'BASIC' as const;
  const LIMIT = PLAN_LIMITS[PLAN].maxServices;

  // R1.6 is defined for "two or more create requests ... while Current_Usage is
  // equal to the Numeric_Limit minus one" — the classic two-writer write-skew
  // for the single remaining slot. The atomic `Serializable` check-then-create
  // plus the `runSerializable` retry-once wrapper is precisely designed for this
  // case: under Postgres SSI one transaction commits and the other is aborted
  // with a serialization failure (40001), retried once, and on retry observes
  // `usage = limit` and is rejected with `PLAN_LIMIT_EXCEEDED`.
  const PARALLEL_REQUESTS = 2;

  let app: INestApplication;
  let prisma: PrismaService;
  let owner: TestOwner;

  beforeAll(async () => {
    const ctx = await createE2EApp();
    app = ctx.app;
    prisma = ctx.prisma;
  });

  afterAll(async () => {
    if (app) {
      await app.close();
    }
  });

  beforeEach(async () => {
    owner = await registerTestOwner(app);
    await setOrgPlan(prisma, owner.orgId, PLAN);
  });

  afterEach(async () => {
    if (owner) {
      await cleanupTestOrg(prisma, owner);
    }
  });

  it('never exceeds the limit under N parallel creates and rejects the excess with PLAN_LIMIT_EXCEEDED', async () => {
    // Sanity: the limit must be a finite number for this race to be meaningful.
    expect(typeof LIMIT).toBe('number');
    const limit = LIMIT as number;

    // Pre-create `limit - 1` services directly so currentUsage = limit - 1.
    const preCount = limit - 1;
    for (let i = 0; i < preCount; i += 1) {
      await prisma.service.create({
        data: {
          orgId: owner.orgId,
          name: `Seed Service ${i}`,
          prefix: `S${i}`,
          sortOrder: i,
        },
      });
    }

    // Fire PARALLEL_REQUESTS concurrent create requests with DISTINCT prefixes
    // (so the only thing that can reject them is the plan-limit check, never a
    // duplicate-prefix conflict).
    const server = app.getHttpServer();
    const attempts = Array.from({ length: PARALLEL_REQUESTS }, (_unused, i) =>
      request(server)
        .post(`/${API_PREFIX}/organizations/${owner.orgId}/services`)
        .set('Authorization', `Bearer ${owner.accessToken}`)
        .send({ name: `Race Service ${i}`, prefix: `R${i}` }),
    );

    const responses = await Promise.all(attempts);

    const created = responses.filter((res) => res.status === 201);
    const rejected = responses.filter((res) => res.status === 403);

    // Exactly the remaining slots (limit - preCount === 1) may succeed.
    const remainingSlots = limit - preCount;
    expect(created).toHaveLength(remainingSlots);
    expect(rejected).toHaveLength(PARALLEL_REQUESTS - remainingSlots);

    // Every rejection is the canonical plan-limit envelope at HTTP 403.
    for (const res of rejected) {
      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe(ERROR_CODES.PLAN_LIMIT_EXCEEDED);
      expect(typeof res.body.error.message).toBe('string');
      expect(res.body.error.message.length).toBeGreaterThan(0);
      expect(res.body.error.details.plan).toBe(PLAN);
    }

    // The authoritative committed count equals the limit — never more.
    const finalCount = await prisma.service.count({ where: { orgId: owner.orgId } });
    expect(finalCount).toBe(limit);

    // No response other than 201/403 should have occurred.
    expect(created.length + rejected.length).toBe(PARALLEL_REQUESTS);
  });
});
