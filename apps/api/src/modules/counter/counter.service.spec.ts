import { PlanType } from '@queuenow/shared-types';
import { ERROR_CODES } from '@queuenow/shared-constants';

import { PlanLimitExceededException } from '../../common/exceptions/plan-limit-exceeded.exception';
import type { IAuthenticatedUser } from '../../common/interfaces';
import type { PrismaService } from '../../prisma/prisma.service';
import { PlanLimitsService } from '../plan/plan-limits.service';
import { CounterService } from './counter.service';

/**
 * Unit tests for `maxCounters` enforcement wired into `CounterService.create`
 * (task 6.4).
 * Validates: Requirements 1.1, 1.2, 1.3, 1.4, 1.5
 *
 * Like the service tests, these exercise the real
 * `PlanLimitsService.assertWithinNumericLimit` decision path through
 * `CounterService.create`'s `runSerializable` transaction, with a mocked Prisma.
 */

const ORG_ID = 'org-1';
const USER: IAuthenticatedUser = { id: 'user-1', orgId: ORG_ID } as IAuthenticatedUser;
const SERVICE_ID = 'svc-1';
const DTO = { name: 'Counter 1', serviceId: SERVICE_ID };

interface CounterStub {
  /** Plan governing `maxCounters` (FREE ⇒ 1, BASIC ⇒ 3, PRO ⇒ null/unlimited). */
  plan: PlanType;
  /** Existing `Counter` rows for the org (the measured Current_Usage). */
  usage: number;
}

function buildCounterService({ plan, usage }: CounterStub): {
  counterService: CounterService;
  create: jest.Mock;
  count: jest.Mock;
} {
  const create = jest.fn().mockResolvedValue({ id: 'counter-1', orgId: ORG_ID, ...DTO });
  const count = jest.fn().mockResolvedValue(usage);

  const prisma = {
    organization: {
      findUnique: jest.fn().mockResolvedValue({ plan }),
    },
    service: {
      // The parent service must exist within the org for the create to proceed.
      findFirst: jest.fn().mockResolvedValue({ id: SERVICE_ID, orgId: ORG_ID }),
    },
    counter: {
      count,
      create,
    },
    $transaction: jest.fn(async (work: (client: unknown) => Promise<unknown>) => work(prisma)),
  } as unknown as PrismaService;

  const planLimits = new PlanLimitsService(prisma);
  return { counterService: new CounterService(prisma, planLimits), create, count };
}

describe('CounterService.create maxCounters enforcement', () => {
  it('allows creation when usage is below the limit and creates the resource (R1.1)', async () => {
    // FREE: maxCounters = 1. Usage 0 < 1 ⇒ allowed.
    const { counterService, create } = buildCounterService({ plan: PlanType.FREE, usage: 0 });

    await expect(counterService.create(ORG_ID, DTO, USER)).resolves.toMatchObject({
      id: 'counter-1',
    });
    expect(create).toHaveBeenCalledTimes(1);
  });

  it('rejects with PLAN_LIMIT_EXCEEDED when usage equals the limit and does not create (R1.2, R1.3)', async () => {
    // FREE: usage 1 >= 1 ⇒ rejected; usage left unchanged (create never called).
    const { counterService, create } = buildCounterService({ plan: PlanType.FREE, usage: 1 });

    try {
      await counterService.create(ORG_ID, DTO, USER);
      throw new Error('expected rejection');
    } catch (error) {
      expect(error).toBeInstanceOf(PlanLimitExceededException);
      const response = (error as PlanLimitExceededException).getResponse() as {
        code: string;
        details: { limitName: string; limit: number; currentUsage: number; plan: PlanType };
      };
      expect(response.code).toBe(ERROR_CODES.PLAN_LIMIT_EXCEEDED);
      expect(response.details).toMatchObject({
        limitName: 'maxCounters',
        limit: 1,
        currentUsage: 1,
        plan: PlanType.FREE,
      });
      expect((error as PlanLimitExceededException).getStatus()).toBe(403);
    }
    expect(create).not.toHaveBeenCalled();
  });

  it('rejects with PLAN_LIMIT_EXCEEDED when usage exceeds the limit (R1.2)', async () => {
    // BASIC: maxCounters = 3. Usage 4 > 3 ⇒ rejected.
    const { counterService, create } = buildCounterService({ plan: PlanType.BASIC, usage: 4 });

    await expect(counterService.create(ORG_ID, DTO, USER)).rejects.toBeInstanceOf(
      PlanLimitExceededException,
    );
    expect(create).not.toHaveBeenCalled();
  });

  it('treats a null limit as unlimited and creates regardless of usage (R1.4)', async () => {
    // PRO: maxCounters = null. Even a huge usage is allowed and usage is never counted.
    const { counterService, create, count } = buildCounterService({
      plan: PlanType.PRO,
      usage: 1_000,
    });

    await expect(counterService.create(ORG_ID, DTO, USER)).resolves.toMatchObject({
      id: 'counter-1',
    });
    expect(create).toHaveBeenCalledTimes(1);
    expect(count).not.toHaveBeenCalled();
  });
});
