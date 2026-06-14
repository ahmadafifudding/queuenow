// Feature: plan-limit-enforcement, Property 11: Upgrade prompts appear exactly for at-limit resources

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  PlanType,
  type NumericResource,
  type PlanLimitName,
  type PlanUsageResource,
  type PlanUsageResponse,
} from '@queuenow/shared-types';

import { atLimitResources } from '../lib/format-usage';

/**
 * Property 11 — Upgrade prompts appear exactly for at-limit resources.
 * Validates: Requirements 8.4
 *
 * For any plan-usage projection, the set of resources the Plan & Usage view
 * shows an upgrade prompt for (i.e. the output of `atLimitResources`) equals the
 * set of resources whose limit is a number AND whose usage is >= that limit.
 *
 * The oracle is an INDEPENDENT recomputation of that membership predicate over
 * the generated resources, so the test does not mirror the selector's body. We
 * also assert the selector ignores the projection's own `atLimit` flag by
 * generating that flag adversarially (sometimes contradicting usage/limit) — the
 * result must follow usage/limit, never the flag.
 */

const RUNS = 200;

const RESOURCE_TO_LIMIT_NAME: Record<NumericResource, PlanLimitName> = {
  services: 'maxServices',
  counters: 'maxCounters',
  staff: 'maxStaff',
  queuePerDay: 'maxQueuePerDay',
};

const ALL_RESOURCES = Object.keys(RESOURCE_TO_LIMIT_NAME) as NumericResource[];

/** A single resource row with an adversarial (possibly wrong) `atLimit` flag. */
function resourceArb(resource: NumericResource): fc.Arbitrary<PlanUsageResource> {
  return fc.record({
    resource: fc.constant(resource),
    limitName: fc.constant(RESOURCE_TO_LIMIT_NAME[resource]),
    usage: fc.nat({ max: 1000 }),
    // `null` ⇒ unlimited; otherwise a non-negative numeric limit.
    limit: fc.option(fc.nat({ max: 1000 }), { nil: null }),
    // Deliberately independent of usage/limit so the selector cannot rely on it.
    atLimit: fc.boolean(),
  });
}

/** A full projection covering every resource exactly once (as the API returns). */
function projectionArb(): fc.Arbitrary<PlanUsageResponse> {
  return fc.record({
    plan: fc.constantFrom(...Object.values(PlanType)),
    features: fc.record({
      tvDisplay: fc.boolean(),
      analytics: fc.boolean(),
      customBranding: fc.boolean(),
    }),
    resources: fc.tuple(...ALL_RESOURCES.map((resource) => resourceArb(resource))),
  });
}

/** Independent oracle: a resource is at limit iff limit is numeric and usage >= limit. */
function expectedAtLimitKeys(projection: PlanUsageResponse): Set<NumericResource> {
  const keys = new Set<NumericResource>();
  for (const resource of projection.resources) {
    if (resource.limit !== null && resource.usage >= resource.limit) {
      keys.add(resource.resource);
    }
  }
  return keys;
}

describe('Property 11: upgrade prompts appear exactly for at-limit resources', () => {
  it('selects exactly the resources whose numeric limit is met or exceeded (R8.4)', () => {
    fc.assert(
      fc.property(projectionArb(), (projection) => {
        const selected = new Set(atLimitResources(projection).map((r) => r.resource));
        expect(selected).toEqual(expectedAtLimitKeys(projection));
      }),
      { numRuns: RUNS },
    );
  });

  it('never selects an unlimited (null-limit) resource, even if its atLimit flag is true', () => {
    fc.assert(
      fc.property(fc.constantFrom(...ALL_RESOURCES), fc.nat(), (resource, usage) => {
        const projection: PlanUsageResponse = {
          plan: PlanType.FREE,
          features: { tvDisplay: false, analytics: false, customBranding: false },
          resources: [
            {
              resource,
              limitName: RESOURCE_TO_LIMIT_NAME[resource],
              usage,
              limit: null,
              atLimit: true, // contradictory on purpose
            },
          ],
        };
        expect(atLimitResources(projection)).toEqual([]);
      }),
      { numRuns: RUNS },
    );
  });

  it('selects exactly at the boundary usage === limit (>=, not >)', () => {
    fc.assert(
      fc.property(fc.constantFrom(...ALL_RESOURCES), fc.nat({ max: 1000 }), (resource, limit) => {
        const projection: PlanUsageResponse = {
          plan: PlanType.BASIC,
          features: { tvDisplay: false, analytics: false, customBranding: false },
          resources: [
            {
              resource,
              limitName: RESOURCE_TO_LIMIT_NAME[resource],
              usage: limit,
              limit,
              atLimit: false, // contradictory on purpose
            },
          ],
        };
        expect(atLimitResources(projection).map((r) => r.resource)).toEqual([resource]);
      }),
      { numRuns: RUNS },
    );
  });
});
