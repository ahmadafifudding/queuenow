/**
 * Shared bootstrap + fixture helpers for the plan-limit-enforcement e2e suites.
 *
 * These integration tests exercise the REAL NestJS application wired to a REAL
 * Postgres database (no mocked Prisma). The helpers here keep the suites small
 * and consistent:
 *
 * - `isDatabaseAvailable()` lets a suite `describe.skip` cleanly when no
 *   `DATABASE_URL` is configured (e.g. CI without a database).
 * - `createE2EApp()` boots `AppModule` and applies the SAME global pipes,
 *   filters, interceptors, and prefix as `src/main.ts`, so the error envelope
 *   and `VALIDATION_ERROR` behave exactly like production.
 * - `registerTestOwner()` / `cleanupTestOrg()` create and tear down a dedicated
 *   test organization + OWNER per run so the dev database is not polluted.
 */
import { INestApplication, ValidationPipe } from '@nestjs/common';
import type { ValidationError } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import request from 'supertest';

import { PlanType } from '@queuenow/db';

import { AppModule } from '../../src/app.module';
import { ValidationException } from '../../src/common/exceptions/validation.exception';
import { HttpExceptionFilter } from '../../src/common/filters/http-exception.filter';
import { TransformInterceptor } from '../../src/common/interceptors/transform.interceptor';
import { PrismaService } from '../../src/prisma/prisma.service';

/** Global prefix applied in `src/main.ts`; mirrored here so paths match prod. */
export const API_PREFIX = 'api/v1';

/**
 * Password used for every test owner registered through `registerTestOwner`.
 * Exported so suites can log the same owner back in (e.g. to capture a fresh
 * `refresh_token` cookie) without duplicating the literal.
 */
export const TEST_OWNER_PASSWORD = 'SecurePassword123!';

/** True when a real database connection string is configured. */
export function isDatabaseAvailable(): boolean {
  const url = process.env.DATABASE_URL;
  return typeof url === 'string' && url.length > 0;
}

export interface E2EContext {
  app: INestApplication;
  prisma: PrismaService;
}

/**
 * Boot the full Nest application with the production global configuration.
 */
export async function createE2EApp(): Promise<E2EContext> {
  const moduleRef: TestingModule = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();

  const app = moduleRef.createNestApplication();

  app.setGlobalPrefix(API_PREFIX);

  // Mirror src/main.ts: parse cookies so the httpOnly `refresh_token` cookie is
  // available on `req.cookies` for the auth refresh/switch flows.
  app.use(cookieParser());

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: {
        enableImplicitConversion: true,
      },
      exceptionFactory: (errors: ValidationError[]): ValidationException =>
        new ValidationException(errors),
    }),
  );

  app.useGlobalFilters(new HttpExceptionFilter());
  app.useGlobalInterceptors(new TransformInterceptor());

  await app.init();

  const prisma = app.get(PrismaService);

  return { app, prisma };
}

export interface TestOwner {
  accessToken: string;
  orgId: string;
  userId: string;
  email: string;
}

interface RegisterResponseBody {
  success: boolean;
  data: {
    user: { id: string; email: string; fullName: string };
    organization: { id: string; name: string; slug: string; role: string };
    tokens: { accessToken: string };
  };
}

/**
 * Register a fresh OWNER + organization through the real auth flow and return
 * the access token plus identifiers needed for assertions and cleanup. A unique
 * email is generated per call so repeated runs never collide.
 */
export async function registerTestOwner(app: INestApplication): Promise<TestOwner> {
  const unique = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  const email = `plan-limit-e2e+${unique}@example.test`;

  const response = await request(app.getHttpServer())
    .post(`/${API_PREFIX}/auth/register`)
    .send({
      email,
      password: TEST_OWNER_PASSWORD,
      fullName: 'Plan Limit E2E Owner',
      organizationName: `Plan Limit E2E Org ${unique}`,
      organizationType: 'CLINIC',
    })
    .expect(201);

  const body = response.body as RegisterResponseBody;

  return {
    accessToken: body.data.tokens.accessToken,
    orgId: body.data.organization.id,
    userId: body.data.user.id,
    email: body.data.user.email,
  };
}

/**
 * Set the organization's plan directly so the suite can control the numeric
 * limit under test (e.g. BASIC ⇒ maxServices = 3). No side effects on resources.
 */
export async function setOrgPlan(
  prisma: PrismaService,
  orgId: string,
  plan: PlanType,
): Promise<void> {
  await prisma.organization.update({
    where: { id: orgId },
    data: { plan },
  });
}

/**
 * Remove all data created by a test owner. Deleting the organization cascades
 * to its services, counters, roles, settings, branding, invitations, and
 * tickets; deleting the user then cascades its sessions. Best-effort: cleanup
 * never throws so a failing assertion is not masked by a teardown error.
 */
export async function cleanupTestOrg(
  prisma: PrismaService,
  owner: Pick<TestOwner, 'orgId' | 'userId'>,
): Promise<void> {
  try {
    await prisma.organization.deleteMany({ where: { id: owner.orgId } });
  } catch {
    // ignore — teardown is best-effort
  }

  try {
    await prisma.session.deleteMany({ where: { userId: owner.userId } });
    await prisma.user.deleteMany({ where: { id: owner.userId } });
  } catch {
    // ignore — teardown is best-effort
  }
}
