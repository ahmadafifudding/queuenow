import { ForbiddenException } from '@nestjs/common';
import { PlanType } from '@queuenow/shared-types';
import type { NumericResource, PlanUsageResponse } from '@queuenow/shared-types';

import type { PlanLimitsService } from '../plan/plan-limits.service';
import { OrganizationController } from './organization.controller';
import type { OrganizationService } from './organization.service';

/**
 * Controller-level contract test for the plan-usage endpoint (task 10.2).
 * _Requirements: 8.1, 8.2, 8.3, 8.4_
 *
 * Focus (the endpoint's response contract — the per-resource projection itself
 * is exercised in `plan-limits-get-usage.test.ts`, task 4.8):
 * - The response includes the resolved `plan` (R8.1).
 * - The response includes a `features` record (mirrors R9 gating).
 * - There is a resource entry per `NumericResource` with the expected
 *   `limit`/`atLimit` contract: a numeric limit with `usage >= limit` ⇒
 *   `atLimit === true`; a `null` limit ⇒ unlimited ⇒ `atLimit === false` (R8.2–R8.4).
 * - The handler delegates to `PlanLimitsService.getPlanUsage(id)`.
 * - The org-scope guard rejects cross-org reads with `ForbiddenException`.
 */

const ALL_NUMERIC_RESOURCES: readonly NumericResource[] = [
  'services',
  'counters',
  'staff',
  'queuePerDay',
];

const ORG_ID = 'org-1';

const user = {
  id: 'user-1',
  email: 'owner@example.com',
  fullName: 'Org Owner',
  orgId: ORG_ID,
  role: 'OWNER' as const,
  type: 'staff' as const,
};

/**
 * A representative projection covering every contract case: an at-limit numeric
 * resource (`services`), a below-limit numeric resource (`counters`/`staff`),
 * and an unlimited (`null`) resource (`queuePerDay`).
 */
const planUsageResponse: PlanUsageResponse = {
  plan: PlanType.FREE,
  features: { tvDisplay: false, analytics: false, customBranding: false },
  resources: [
    { resource: 'services', limitName: 'maxServices', usage: 1, limit: 1, atLimit: true },
    { resource: 'counters', limitName: 'maxCounters', usage: 0, limit: 1, atLimit: false },
    { resource: 'staff', limitName: 'maxStaff', usage: 1, limit: 2, atLimit: false },
    {
      resource: 'queuePerDay',
      limitName: 'maxQueuePerDay',
      usage: 9999,
      limit: null,
      atLimit: false,
    },
  ],
};

function buildController(): {
  controller: OrganizationController;
  getPlanUsage: jest.Mock;
} {
  const getPlanUsage = jest.fn().mockResolvedValue(planUsageResponse);
  const organizationService = {} as OrganizationService;
  const planLimitsService = { getPlanUsage } as unknown as PlanLimitsService;
  const controller = new OrganizationController(organizationService, planLimitsService);
  return { controller, getPlanUsage };
}

describe('OrganizationController.getPlanUsage (contract)', () => {
  it('delegates to PlanLimitsService.getPlanUsage with the org id', async () => {
    const { controller, getPlanUsage } = buildController();

    await controller.getPlanUsage(ORG_ID, user);

    expect(getPlanUsage).toHaveBeenCalledTimes(1);
    expect(getPlanUsage).toHaveBeenCalledWith(ORG_ID);
  });

  it('returns a response that includes the plan and a features record', async () => {
    const { controller } = buildController();

    const result = await controller.getPlanUsage(ORG_ID, user);

    expect(result.plan).toBe(PlanType.FREE);
    expect(result.features).toEqual({
      tvDisplay: false,
      analytics: false,
      customBranding: false,
    });
  });

  it('includes a resource entry for every NumericResource', async () => {
    const { controller } = buildController();

    const result = await controller.getPlanUsage(ORG_ID, user);

    const resources = result.resources.map((r) => r.resource).sort();
    expect(resources).toEqual([...ALL_NUMERIC_RESOURCES].sort());
  });

  it('honors the limit/atLimit contract: numeric usage>=limit ⇒ atLimit; null ⇒ unlimited', async () => {
    const { controller } = buildController();

    const result = await controller.getPlanUsage(ORG_ID, user);
    const byResource = result.resources.reduce(
      (acc, entry) => {
        acc[entry.resource] = entry;
        return acc;
      },
      {} as Record<NumericResource, PlanUsageResponse['resources'][number]>,
    );

    // Numeric limit reached ⇒ atLimit true.
    expect(byResource.services).toMatchObject({ limit: 1, usage: 1, atLimit: true });
    // Numeric limit not reached ⇒ atLimit false.
    expect(byResource.counters).toMatchObject({ limit: 1, usage: 0, atLimit: false });
    // null limit ⇒ unlimited ⇒ atLimit always false, regardless of usage.
    expect(byResource.queuePerDay.limit).toBeNull();
    expect(byResource.queuePerDay.atLimit).toBe(false);

    // Every entry's atLimit is consistent with the limit/usage contract.
    for (const entry of result.resources) {
      const expected = entry.limit !== null && entry.usage >= entry.limit;
      expect(entry.atLimit).toBe(expected);
    }
  });

  it('rejects a cross-org read with ForbiddenException without calling the service', async () => {
    const { controller, getPlanUsage } = buildController();
    const otherUser = { ...user, orgId: 'org-2' };

    await expect(controller.getPlanUsage(ORG_ID, otherUser)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(getPlanUsage).not.toHaveBeenCalled();
  });
});
