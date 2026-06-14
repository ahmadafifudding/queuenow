import { ERROR_CODES } from '@queuenow/shared-constants';
import { PlanType } from '@queuenow/shared-types';

import { PlanLimitExceededException } from '../../common/exceptions/plan-limit-exceeded.exception';
import type { PrismaService } from '../../prisma/prisma.service';
import { PlanLimitsService } from '../plan/plan-limits.service';
import { resolveDailyWindow } from '../plan/plan-window.util';
import { QueueService } from './queue.service';
import type { QueueGateway } from './queue.gateway';

/**
 * Unit tests for daily-queue-volume enforcement wired into `QueueService.joinQueue`
 * (task 7.2).
 * Validates: Requirements 2.1, 2.2, 2.3, 2.4
 *
 * The authoritative Daily_Queue_Volume is the sum of `DailyQueueCounter.lastNumber`
 * for the org-timezone window date (design "Daily-queue-volume window + counting").
 * These tests exercise the real `PlanLimitsService.assertWithinDailyQueueLimit`
 * decision path — the exact call `joinQueue` makes inside its transaction — with a
 * mocked Prisma so the policy is validated in isolation, plus a wiring test that
 * confirms `joinQueue` aborts the create when the plan limit is exceeded.
 */

const ORG_ID = 'org-1';
const TIMEZONE = 'Asia/Kuala_Lumpur';
const RESET_TIME = '00:00';

interface DailyVolumeStub {
  plan: PlanType;
  volume: number;
  orgExists?: boolean;
  timezone?: string;
  resetTime?: string;
}

/**
 * Minimal Prisma stub exposing only what `assertWithinDailyQueueLimit` touches:
 * the org lookup (plan + timezone + resetTime) and the `DailyQueueCounter`
 * aggregate that sums `lastNumber` for the window date.
 */
function mockPrisma({
  plan,
  volume,
  orgExists = true,
  timezone = TIMEZONE,
  resetTime = RESET_TIME,
}: DailyVolumeStub): {
  prisma: PrismaService;
  aggregate: jest.Mock;
} {
  const aggregate = jest.fn().mockResolvedValue({ _sum: { lastNumber: volume } });
  const prisma = {
    organization: {
      findUnique: jest
        .fn()
        .mockResolvedValue(orgExists ? { plan, timezone, settings: { resetTime } } : null),
    },
    dailyQueueCounter: { aggregate },
  } as unknown as PrismaService;

  return { prisma, aggregate };
}

describe('Daily-queue-volume enforcement (assertWithinDailyQueueLimit)', () => {
  it('allows a join when the volume is below maxQueuePerDay (R2.1)', async () => {
    // FREE: maxQueuePerDay = 30. Volume 29 < 30 ⇒ allowed.
    const { prisma } = mockPrisma({ plan: PlanType.FREE, volume: 29 });
    const service = new PlanLimitsService(prisma);

    await expect(service.assertWithinDailyQueueLimit(prisma, ORG_ID)).resolves.toBeUndefined();
  });

  it('rejects with PLAN_LIMIT_EXCEEDED when the volume equals maxQueuePerDay (R2.2)', async () => {
    // FREE: 30 >= 30 ⇒ rejected.
    const { prisma } = mockPrisma({ plan: PlanType.FREE, volume: 30 });
    const service = new PlanLimitsService(prisma);

    await expect(service.assertWithinDailyQueueLimit(prisma, ORG_ID)).rejects.toBeInstanceOf(
      PlanLimitExceededException,
    );

    try {
      await service.assertWithinDailyQueueLimit(prisma, ORG_ID);
      throw new Error('expected rejection');
    } catch (error) {
      expect(error).toBeInstanceOf(PlanLimitExceededException);
      const response = (error as PlanLimitExceededException).getResponse() as {
        code: string;
        details: { limitName: string; limit: number; currentUsage: number; plan: PlanType };
      };
      expect(response.code).toBe(ERROR_CODES.PLAN_LIMIT_EXCEEDED);
      expect(response.details).toMatchObject({
        limitName: 'maxQueuePerDay',
        limit: 30,
        currentUsage: 30,
        plan: PlanType.FREE,
      });
      expect((error as PlanLimitExceededException).getStatus()).toBe(403);
    }
  });

  it('rejects with PLAN_LIMIT_EXCEEDED when the volume exceeds maxQueuePerDay (R2.2)', async () => {
    const { prisma } = mockPrisma({ plan: PlanType.FREE, volume: 45 });
    const service = new PlanLimitsService(prisma);

    await expect(service.assertWithinDailyQueueLimit(prisma, ORG_ID)).rejects.toBeInstanceOf(
      PlanLimitExceededException,
    );
  });

  it('allows unbounded joins when maxQueuePerDay is null (unlimited) (R2.3)', async () => {
    // BASIC: maxQueuePerDay = null. Even a huge volume is allowed and the
    // counter is never aggregated because the method returns before counting.
    const { prisma, aggregate } = mockPrisma({ plan: PlanType.BASIC, volume: 1_000_000 });
    const service = new PlanLimitsService(prisma);

    await expect(service.assertWithinDailyQueueLimit(prisma, ORG_ID)).resolves.toBeUndefined();
    expect(aggregate).not.toHaveBeenCalled();
  });

  it('measures the volume over the org-timezone reset-time window (R2.4)', async () => {
    const { prisma, aggregate } = mockPrisma({
      plan: PlanType.FREE,
      volume: 5,
      timezone: TIMEZONE,
      resetTime: RESET_TIME,
    });
    const service = new PlanLimitsService(prisma);

    await service.assertWithinDailyQueueLimit(prisma, ORG_ID);

    // The aggregate must be scoped to the window date computed by the shared
    // window helper for this org's timezone + reset time.
    const expectedWindowDate = resolveDailyWindow(TIMEZONE, RESET_TIME, new Date()).windowDate;
    expect(aggregate).toHaveBeenCalledTimes(1);
    const where = aggregate.mock.calls[0][0].where as { orgId: string; date: Date };
    expect(where.orgId).toBe(ORG_ID);
    expect(where.date.getTime()).toBe(expectedWindowDate.getTime());
  });
});

describe('QueueService.joinQueue daily-volume wiring', () => {
  const SERVICE = {
    id: 'svc-1',
    orgId: ORG_ID,
    prefix: 'A',
    avgServingTime: 5,
    maxQueuePerDay: null as number | null,
    isActive: true,
  };

  function buildQueueService(planLimitsThrows: boolean): {
    queueService: QueueService;
    txCreate: jest.Mock;
  } {
    const txCreate = jest.fn().mockResolvedValue({ id: 'ticket-1', createdAt: new Date() });
    const tx = {
      dailyQueueCounter: { upsert: jest.fn().mockResolvedValue({ lastNumber: 1 }) },
      queueTicket: { create: txCreate },
    };

    const prisma = {
      organization: {
        findFirst: jest.fn().mockResolvedValue({ id: ORG_ID, isActive: true, settings: {} }),
      },
      service: { findFirst: jest.fn().mockResolvedValue(SERVICE) },
      queueTicket: { count: jest.fn().mockResolvedValue(1) },
      $transaction: jest.fn(async (cb: (client: typeof tx) => Promise<unknown>) => cb(tx)),
    } as unknown as PrismaService;

    const queueGateway = {
      emitQueueUpdate: jest.fn(),
      emitTicketCalled: jest.fn(),
    } as unknown as QueueGateway;

    const planLimits = {
      assertWithinDailyQueueLimit: jest.fn(async () => {
        if (planLimitsThrows) {
          throw new PlanLimitExceededException({
            limitName: 'maxQueuePerDay',
            limit: 30,
            currentUsage: 30,
            plan: PlanType.FREE,
          });
        }
      }),
    } as unknown as PlanLimitsService;

    return {
      queueService: new QueueService(prisma, queueGateway, planLimits),
      txCreate,
    };
  }

  it('creates the ticket when the daily-volume check passes', async () => {
    const { queueService, txCreate } = buildQueueService(false);

    await expect(queueService.joinQueue(ORG_ID, { serviceId: SERVICE.id })).resolves.toMatchObject({
      id: 'ticket-1',
    });
    expect(txCreate).toHaveBeenCalledTimes(1);
  });

  it('does not create the ticket when the daily-volume check rejects (R2.2)', async () => {
    const { queueService, txCreate } = buildQueueService(true);

    await expect(queueService.joinQueue(ORG_ID, { serviceId: SERVICE.id })).rejects.toBeInstanceOf(
      PlanLimitExceededException,
    );
    expect(txCreate).not.toHaveBeenCalled();
  });
});
