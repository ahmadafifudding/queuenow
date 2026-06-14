import { PlanType } from '@queuenow/shared-types';
import { ERROR_CODES } from '@queuenow/shared-constants';

import { PlanLimitExceededException } from '../../common/exceptions/plan-limit-exceeded.exception';
import type { IAuthenticatedUser } from '../../common/interfaces';
import type { PrismaService } from '../../prisma/prisma.service';
import { PlanLimitsService } from '../plan/plan-limits.service';
import { ServiceService } from './service.service';

/**
 * Unit tests for `maxServices` enforcement wired into `ServiceService.create`
 * (task 6.4).
 * Validates: Requirements 1.1, 1.2, 1.3, 1.4, 1.5
 *
 * These tests exercise the real `PlanLimitsService.assertWithinNumericLimit`
 * decision path — the exact call `ServiceService.create` makes inside its
 * `runSerializable` transaction — with a mocked Prisma so the enforcement is
 * validated in isolation. `$transaction` is mocked to invoke the work callback
 * with the same mocked client, mirroring `runSerializable`'s single-shot path.
 */

const ORG_ID = 'org-1';
const USER: IAuthenticatedUser = { id: 'user-1', orgId: ORG_ID } as IAuthenticatedUser;
const DTO = { name: 'Registration', prefix: 'A' };

interface ServiceStub {
  /** Plan governing `maxServices` (FREE ⇒ 1, BASIC ⇒ 3, PRO ⇒ null/unlimited). */
  plan: PlanType;
  /** Existing `Service` rows for the org (the measured Current_Usage). */
  usage: number;
  /** Whether a service with the same prefix already exists (duplicate check). */
  duplicate?: boolean;
}

function buildServiceService({ plan, usage, duplicate = false }: ServiceStub): {
  serviceService: ServiceService;
  create: jest.Mock;
  count: jest.Mock;
} {
  const create = jest.fn().mockResolvedValue({ id: 'svc-1', orgId: ORG_ID, ...DTO });
  const count = jest.fn().mockResolvedValue(usage);

  const prisma = {
    organization: {
      findUnique: jest.fn().mockResolvedValue({ plan }),
    },
    service: {
      count,
      findUnique: jest.fn().mockResolvedValue(duplicate ? { id: 'existing', ...DTO } : null),
      create,
    },
    $transaction: jest.fn(async (work: (client: unknown) => Promise<unknown>) => work(prisma)),
  } as unknown as PrismaService;

  const planLimits = new PlanLimitsService(prisma);
  return { serviceService: new ServiceService(prisma, planLimits), create, count };
}

describe('ServiceService.create maxServices enforcement', () => {
  it('allows creation when usage is below the limit and creates the resource (R1.1)', async () => {
    // FREE: maxServices = 1. Usage 0 < 1 ⇒ allowed.
    const { serviceService, create } = buildServiceService({ plan: PlanType.FREE, usage: 0 });

    await expect(serviceService.create(ORG_ID, DTO, USER)).resolves.toMatchObject({ id: 'svc-1' });
    expect(create).toHaveBeenCalledTimes(1);
  });

  it('rejects with PLAN_LIMIT_EXCEEDED when usage equals the limit and does not create (R1.2, R1.3)', async () => {
    // FREE: usage 1 >= 1 ⇒ rejected; usage left unchanged (create never called).
    const { serviceService, create } = buildServiceService({ plan: PlanType.FREE, usage: 1 });

    await expect(serviceService.create(ORG_ID, DTO, USER)).rejects.toBeInstanceOf(
      PlanLimitExceededException,
    );
    expect(create).not.toHaveBeenCalled();
  });

  it('rejects with PLAN_LIMIT_EXCEEDED when usage exceeds the limit (R1.2)', async () => {
    // BASIC: maxServices = 3. Usage 5 > 3 ⇒ rejected (over-limit, e.g. after downgrade).
    const { serviceService, create } = buildServiceService({ plan: PlanType.BASIC, usage: 5 });

    try {
      await serviceService.create(ORG_ID, DTO, USER);
      throw new Error('expected rejection');
    } catch (error) {
      expect(error).toBeInstanceOf(PlanLimitExceededException);
      const response = (error as PlanLimitExceededException).getResponse() as {
        code: string;
        details: { limitName: string; limit: number; currentUsage: number; plan: PlanType };
      };
      expect(response.code).toBe(ERROR_CODES.PLAN_LIMIT_EXCEEDED);
      expect(response.details).toMatchObject({
        limitName: 'maxServices',
        limit: 3,
        currentUsage: 5,
        plan: PlanType.BASIC,
      });
      expect((error as PlanLimitExceededException).getStatus()).toBe(403);
    }
    expect(create).not.toHaveBeenCalled();
  });

  it('treats a null limit as unlimited and creates regardless of usage (R1.4)', async () => {
    // PRO: maxServices = null. Even a huge usage is allowed and usage is never counted.
    const { serviceService, create, count } = buildServiceService({
      plan: PlanType.PRO,
      usage: 1_000,
    });

    await expect(serviceService.create(ORG_ID, DTO, USER)).resolves.toMatchObject({ id: 'svc-1' });
    expect(create).toHaveBeenCalledTimes(1);
    expect(count).not.toHaveBeenCalled();
  });
});
