import { PlanType } from '@queuenow/shared-types';
import type { NumericResource } from '@queuenow/shared-types';

import { OrgNotFoundException } from '../../common/exceptions/org-not-found.exception';
import type { PrismaService } from '../../prisma/prisma.service';
import { PlanLimitsService } from './plan-limits.service';

/**
 * Unit tests for the `getPlanUsage` projection (task 4.8).
 * Validates: Requirements 8.2, 8.3, 8.4
 *
 * Focus:
 * - `null` limit ⇒ `atLimit === false` (unlimited representation), regardless of
 *   how large usage is.
 * - `usage >= limit` ⇒ `atLimit === true`, and `usage < limit` ⇒ `atLimit === false`.
 * - Every `NumericResource` is present, the resolved `plan` and `features` record
 *   are surfaced, and an unknown org throws `OrgNotFoundException`.
 *
 * PrismaService counts are mocked so the projection is tested in isolation.
 */

const ORG_ID = 'org-1';

interface UsageCounts {
  services: number;
  counters: number;
  userRoles: number;
  pendingInvitations: number;
  dailyVolume: number;
}

/**
 * Build a minimal PrismaService stub returning the supplied counts. Only the
 * read methods `getPlanUsage` touches are implemented.
 */
function mockPrisma(
  plan: PlanType,
  counts: UsageCounts,
  orgExists = true,
): { prisma: PrismaService } {
  const prisma = {
    organization: {
      findUnique: jest.fn().mockResolvedValue(
        orgExists
          ? {
              plan,
              timezone: 'Asia/Kuala_Lumpur',
              settings: { resetTime: '00:00' },
            }
          : null,
      ),
    },
    service: { count: jest.fn().mockResolvedValue(counts.services) },
    counter: { count: jest.fn().mockResolvedValue(counts.counters) },
    userRole: { count: jest.fn().mockResolvedValue(counts.userRoles) },
    invitation: { count: jest.fn().mockResolvedValue(counts.pendingInvitations) },
    dailyQueueCounter: {
      aggregate: jest.fn().mockResolvedValue({ _sum: { lastNumber: counts.dailyVolume } }),
    },
  } as unknown as PrismaService;

  return { prisma };
}

const byResource = (
  resources: Awaited<ReturnType<PlanLimitsService['getPlanUsage']>>['resources'],
): Record<NumericResource, (typeof resources)[number]> => {
  return resources.reduce(
    (acc, entry) => {
      acc[entry.resource] = entry;
      return acc;
    },
    {} as Record<NumericResource, (typeof resources)[number]>,
  );
};

describe('PlanLimitsService.getPlanUsage', () => {
  it('throws OrgNotFoundException for an unknown org', async () => {
    const { prisma } = mockPrisma(
      PlanType.FREE,
      { services: 0, counters: 0, userRoles: 0, pendingInvitations: 0, dailyVolume: 0 },
      false,
    );
    const service = new PlanLimitsService(prisma);

    await expect(service.getPlanUsage(ORG_ID)).rejects.toBeInstanceOf(OrgNotFoundException);
  });

  it('covers all four numeric resources and surfaces the resolved plan + features', async () => {
    const { prisma } = mockPrisma(PlanType.FREE, {
      services: 0,
      counters: 0,
      userRoles: 0,
      pendingInvitations: 0,
      dailyVolume: 0,
    });
    const service = new PlanLimitsService(prisma);

    const usage = await service.getPlanUsage(ORG_ID);

    expect(usage.plan).toBe(PlanType.FREE);
    // FREE disables every feature flag.
    expect(usage.features).toEqual({ tvDisplay: false, analytics: false, customBranding: false });
    expect(usage.resources.map((r) => r.resource).sort()).toEqual(
      ['counters', 'queuePerDay', 'services', 'staff'].sort(),
    );
  });

  it('null limit ⇒ atLimit === false even when usage is large (unlimited)', async () => {
    // PRO has every numeric limit set to null (unlimited).
    const { prisma } = mockPrisma(PlanType.PRO, {
      services: 999,
      counters: 999,
      userRoles: 500,
      pendingInvitations: 500,
      dailyVolume: 100000,
    });
    const service = new PlanLimitsService(prisma);

    const usage = await service.getPlanUsage(ORG_ID);

    for (const entry of usage.resources) {
      expect(entry.limit).toBeNull();
      expect(entry.atLimit).toBe(false);
    }
    // Usage values are still reported for unlimited resources.
    const map = byResource(usage.resources);
    expect(map.services.usage).toBe(999);
    expect(map.staff.usage).toBe(1000); // userRoles + pending invitations
    expect(map.queuePerDay.usage).toBe(100000);
  });

  it('usage >= limit ⇒ atLimit === true; usage < limit ⇒ atLimit === false', async () => {
    // FREE: maxServices=1, maxCounters=1, maxStaff=2, maxQueuePerDay=30.
    // services at the limit (1>=1), counters below (0<1),
    // staff over (3>=2), queuePerDay below (10<30).
    const { prisma } = mockPrisma(PlanType.FREE, {
      services: 1,
      counters: 0,
      userRoles: 2,
      pendingInvitations: 1,
      dailyVolume: 10,
    });
    const service = new PlanLimitsService(prisma);

    const map = byResource((await service.getPlanUsage(ORG_ID)).resources);

    expect(map.services).toMatchObject({
      limitName: 'maxServices',
      limit: 1,
      usage: 1,
      atLimit: true,
    });
    expect(map.counters).toMatchObject({
      limitName: 'maxCounters',
      limit: 1,
      usage: 0,
      atLimit: false,
    });
    // staff usage = userRoles(2) + pendingInvitations(1) = 3 >= 2.
    expect(map.staff).toMatchObject({ limitName: 'maxStaff', limit: 2, usage: 3, atLimit: true });
    expect(map.queuePerDay).toMatchObject({
      limitName: 'maxQueuePerDay',
      limit: 30,
      usage: 10,
      atLimit: false,
    });
  });
});
