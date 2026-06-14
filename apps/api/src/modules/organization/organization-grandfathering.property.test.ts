import fc from 'fast-check';

import { PLAN_LIMITS } from '@queuenow/shared-constants';
import { PlanType } from '@queuenow/shared-types';
import type { FeatureFlag } from '@queuenow/shared-types';

import type { PrismaService } from '../../prisma/prisma.service';
import { PlanLimitsService } from '../plan/plan-limits.service';
import { OrganizationService } from './organization.service';

/**
 * Grandfathering invariants for the manual plan-change path (task 9.4).
 *
 * These tests exercise the REAL `OrganizationService.changePlan` against an
 * in-memory Prisma double whose `organization.update` applies only the supplied
 * `data` to the stored org (mirroring Prisma's behaviour: update touches no other
 * rows). Grandfathering (R5) is a consequence of `changePlan` doing nothing more
 * than `organization.update({ where: { id }, data: { plan } })` — it never
 * deletes, deactivates, or modifies existing Services/Counters/Staff/tickets/
 * branding/settings. The feature decision used for access is the pure
 * `PlanLimitsService.isFeatureEnabled`.
 */

const PLANS: PlanType[] = Object.values(PlanType);
const FEATURE_FLAGS: FeatureFlag[] = ['tvDisplay', 'analytics'];

const NUM_RUNS = 200;

/** Plans whose `flag` resolves to `value` in the static PLAN_LIMITS table. */
const plansWhere = (flag: FeatureFlag, value: boolean): PlanType[] =>
  PLANS.filter((p) => PLAN_LIMITS[p][flag] === value);

/** A minimal "surface configuration" record (branding / queue settings shape). */
const configArb = (): fc.Arbitrary<Record<string, unknown>> =>
  fc.record({
    logoUrl: fc.option(fc.string(), { nil: null }),
    primaryColor: fc.string(),
    qrText: fc.string(),
    resetTime: fc.string(),
    maxRecall: fc.nat({ max: 10 }),
    requireName: fc.boolean(),
    requirePhone: fc.boolean(),
  });

/** A minimal owned-resource row (a Service / Counter / Staff / ticket). */
const resourceArb = (): fc.Arbitrary<Record<string, unknown>> =>
  fc.record({
    id: fc.string({ minLength: 1, maxLength: 12 }),
    name: fc.string(),
    isActive: fc.boolean(),
  });

/**
 * The full org state an org-scoped read would return: its plan plus every
 * resource collection and configuration record. `changePlan` must leave every
 * field except `plan` untouched.
 */
interface OrgState {
  id: string;
  plan: PlanType;
  name: string;
  address: string | null;
  phone: string | null;
  email: string | null;
  timezone: string;
  branding: Record<string, unknown>;
  settings: Record<string, unknown>;
  services: ReadonlyArray<Record<string, unknown>>;
  counters: ReadonlyArray<Record<string, unknown>>;
  staff: ReadonlyArray<Record<string, unknown>>;
  tickets: ReadonlyArray<Record<string, unknown>>;
  createdAt: string;
  updatedAt: string;
}

const orgStateArb = (): fc.Arbitrary<OrgState> =>
  fc.record({
    id: fc.constant('org-1'),
    plan: fc.constantFrom(...PLANS),
    name: fc.string(),
    address: fc.option(fc.string(), { nil: null }),
    phone: fc.option(fc.string(), { nil: null }),
    email: fc.option(fc.string(), { nil: null }),
    timezone: fc.constantFrom('UTC', 'Asia/Kuala_Lumpur', 'America/New_York'),
    branding: configArb(),
    settings: configArb(),
    services: fc.array(resourceArb(), { maxLength: 5 }),
    counters: fc.array(resourceArb(), { maxLength: 5 }),
    staff: fc.array(resourceArb(), { maxLength: 5 }),
    tickets: fc.array(resourceArb(), { maxLength: 8 }),
    createdAt: fc.constant('2024-01-01T00:00:00.000Z'),
    updatedAt: fc.constant('2024-01-01T00:00:00.000Z'),
  });

interface UpdateCall {
  where: unknown;
  data: Record<string, unknown>;
}

interface OrgPrismaDouble {
  prisma: PrismaService;
  getStored: () => OrgState;
  updateCalls: UpdateCall[];
  /** Mutation spies for every NON-organization model; none should ever fire. */
  sideEffectSpies: jest.Mock[];
}

/**
 * Build an in-memory Prisma double around a single organization. `update`
 * merges only its `data` into the stored org (no side effects on any other
 * model) and records the call so tests can assert the payload is exactly
 * `{ plan }`. Mutation methods on every other model are spies that must remain
 * uncalled — proving the plan change has no side effects on owned resources.
 */
function makeOrgPrisma(initial: OrgState): OrgPrismaDouble {
  let stored: OrgState = { ...initial };
  const updateCalls: UpdateCall[] = [];
  const sideEffectSpies: jest.Mock[] = [];

  const mutationSpies = (): Record<string, jest.Mock> => {
    const del = jest.fn();
    const deleteMany = jest.fn();
    const update = jest.fn();
    const updateMany = jest.fn();
    const create = jest.fn();
    sideEffectSpies.push(del, deleteMany, update, updateMany, create);
    return { delete: del, deleteMany, update, updateMany, create };
  };

  const prismaMock = {
    organization: {
      findUnique: jest.fn(async (): Promise<OrgState> => stored),
      update: jest.fn(async ({ where, data }: UpdateCall): Promise<OrgState> => {
        updateCalls.push({ where, data });
        stored = { ...stored, ...data };
        return stored;
      }),
    },
    service: mutationSpies(),
    counter: mutationSpies(),
    userRole: mutationSpies(),
    invitation: mutationSpies(),
    queueTicket: mutationSpies(),
    organizationBranding: mutationSpies(),
    queueSettings: mutationSpies(),
  };

  return {
    prisma: prismaMock as unknown as PrismaService,
    getStored: () => stored,
    updateCalls,
    sideEffectSpies,
  };
}

const planLimits = new PlanLimitsService({} as unknown as PrismaService);

// Feature: plan-limit-enforcement, Property 6: A plan change never mutates existing resources or configuration
describe('Property 6: A plan change never mutates existing resources or configuration', () => {
  // Validates: Requirements 5.1, 5.4
  it('changes only the plan field for any org state and any target plan', async () => {
    await fc.assert(
      fc.asyncProperty(orgStateArb(), fc.constantFrom(...PLANS), async (initial, target) => {
        const { prisma, updateCalls, sideEffectSpies } = makeOrgPrisma(initial);
        const service = new OrganizationService(prisma);

        const result = (await service.changePlan(initial.id, target, initial.id)) as OrgState;

        // The result reflects the target plan and is otherwise the original org.
        expect(result.plan).toBe(target);
        expect(result).toEqual({ ...initial, plan: target });

        // Field-by-field: nothing except `plan` differs from the original state.
        const before = initial as unknown as Record<string, unknown>;
        const after = result as unknown as Record<string, unknown>;
        for (const key of Object.keys(before)) {
          if (key === 'plan') continue;
          expect(after[key]).toEqual(before[key]);
        }

        // The only persisted write is `organization.update` with data === { plan }.
        if (target === initial.plan) {
          // Idempotent no-op: no write at all (R6.6).
          expect(updateCalls).toHaveLength(0);
        } else {
          expect(updateCalls).toHaveLength(1);
          expect(Object.keys(updateCalls[0].data)).toEqual(['plan']);
          expect(updateCalls[0].data.plan).toBe(target);
        }

        // No owned resource or configuration row was deleted, updated, or created.
        for (const spy of sideEffectSpies) {
          expect(spy).not.toHaveBeenCalled();
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });
});

/** A disable→enable round-trip scenario for a chosen feature flag. */
interface RoundTripScenario {
  flag: FeatureFlag;
  truePlan: PlanType;
  falsePlan: PlanType;
  config: Record<string, unknown>;
}

const roundTripScenarioArb = (): fc.Arbitrary<RoundTripScenario> =>
  fc.constantFrom(...FEATURE_FLAGS).chain((flag) =>
    fc.record({
      flag: fc.constant(flag),
      truePlan: fc.constantFrom(...plansWhere(flag, true)),
      falsePlan: fc.constantFrom(...plansWhere(flag, false)),
      config: configArb(),
    }),
  );

// Feature: plan-limit-enforcement, Property 7: Disabling then re-enabling a feature preserves config and restores access
describe('Property 7: Disabling then re-enabling a feature preserves config and restores access', () => {
  // Validates: Requirements 5.5
  it('preserves surface config and restores access across a disable→enable round-trip', async () => {
    await fc.assert(
      fc.asyncProperty(roundTripScenarioArb(), async ({ flag, truePlan, falsePlan, config }) => {
        const initial: OrgState = {
          id: 'org-1',
          plan: truePlan,
          name: 'Acme',
          address: null,
          phone: null,
          email: null,
          timezone: 'UTC',
          branding: config,
          settings: config,
          services: [],
          counters: [],
          staff: [],
          tickets: [],
          createdAt: '2024-01-01T00:00:00.000Z',
          updatedAt: '2024-01-01T00:00:00.000Z',
        };
        const { prisma, getStored } = makeOrgPrisma(initial);
        const service = new OrganizationService(prisma);

        // Start enabled: the feature flag is true, so access is permitted.
        expect(planLimits.isFeatureEnabled(truePlan, flag)).toBe(true);

        // Disable: change to a plan whose flag is false. Access is now denied,
        // but the surface configuration is retained unchanged (R5.4).
        const disabled = (await service.changePlan('org-1', falsePlan, 'org-1')) as OrgState;
        expect(disabled.plan).toBe(falsePlan);
        expect(planLimits.isFeatureEnabled(falsePlan, flag)).toBe(false);
        expect(getStored().branding).toEqual(config);
        expect(getStored().settings).toEqual(config);

        // Re-enable: change back to a plan whose flag is true. Access is restored
        // and the configuration is still identical — a round-trip with no data
        // loss (R5.5).
        const reEnabled = (await service.changePlan('org-1', truePlan, 'org-1')) as OrgState;
        expect(reEnabled.plan).toBe(truePlan);
        expect(planLimits.isFeatureEnabled(truePlan, flag)).toBe(true);
        expect(getStored().branding).toEqual(config);
        expect(getStored().settings).toEqual(config);
        expect(reEnabled.branding).toEqual(config);
        expect(reEnabled.settings).toEqual(config);
      }),
      { numRuns: NUM_RUNS },
    );
  });
});
