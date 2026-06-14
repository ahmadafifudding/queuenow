// Feature: web-app, Property 9: Successful feature mutations invalidate that feature's query keys
//
// Validates: Requirements 8.5, 9.5, 10.4
//
// The services/counters/staff CRUD mutation hooks (tasks 11-13) do NOT exist
// yet, so this test cannot drive the not-yet-written `onSuccess` callbacks
// directly. Per the dependency graph, Property 9 is scheduled now, so we pin the
// INVARIANT/CONTRACT those hooks will rely on at the level that exists today:
//
//   * the central `queryKeys` factory (`lib/api/query-keys.ts`), and
//   * the tiny `invalidateFeature` helper (`lib/api/invalidate-feature.ts`) that
//     each future mutation hook will call in `onSuccess`.
//
// A successful mutation's effect is modelled by calling `invalidateFeature` on a
// real `QueryClient` whose cache has been seeded with a diverse set of queries
// (the target feature/org/page plus unrelated features, orgs and pages). The
// oracle is an INDEPENDENT prefix-match function (NOT TanStack's matcher and NOT
// the factory) describing exactly which queries a feature mutation should touch:
// a seeded query is invalidated iff its key is prefixed by the invalidated
// feature key. We then assert the real client's `isInvalidated` state equals the
// oracle for every seeded query, and additionally that the target's own key is
// invalidated while cross-feature / cross-org / cross-page keys are not.
//
// fast-check + Vitest, minimum 100 runs.
import type { QueryClient } from '@tanstack/react-query';
import fc from 'fast-check';
import { afterEach, describe, expect, it } from 'vitest';

import {
  featureQueryKey,
  invalidateFeature,
  type FeatureInvalidation,
} from '@/lib/api/invalidate-feature';
import { queryKeys } from '@/lib/api/query-keys';
import { createTestQueryClient } from '@/test/harness';

// ---------------------------------------------------------------------------
// Oracle (independent of the factory and of TanStack's matcher)
// ---------------------------------------------------------------------------

type QueryKey = readonly unknown[];

/**
 * Independent prefix-match oracle: `seeded` is affected by invalidating `target`
 * iff every element of `target` deep-equals the corresponding element of
 * `seeded` (i.e. `target` is a prefix of `seeded`). This is the partial-match
 * semantics a feature invalidation depends on, written by hand so the test does
 * not merely mirror the implementation it checks.
 */
function isPrefixMatch(target: QueryKey, seeded: QueryKey): boolean {
  if (seeded.length < target.length) {
    return false;
  }
  return target.every((segment, index) => Object.is(segment, seeded[index]));
}

// ---------------------------------------------------------------------------
// Generators
// ---------------------------------------------------------------------------

/** A non-empty org id token (kept short + simple; uniqueness handled by callers). */
const orgIdArb = fc
  .array(fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz0123456789'.split('')), {
    minLength: 1,
    maxLength: 8,
  })
  .map((chars) => chars.join(''));

/** Staff page numbers are 1-based, bounded for sane cache sizes. */
const pageArb = fc.integer({ min: 1, max: 20 });

/** Which feature a (simulated) mutation belongs to. */
const featureArb: fc.Arbitrary<'services' | 'counters' | 'staff'> = fc.constantFrom(
  'services',
  'counters',
  'staff',
);

/** A fully-resolved test scenario. */
interface Scenario {
  readonly feature: 'services' | 'counters' | 'staff';
  readonly targetOrg: string;
  readonly targetPage: number;
  readonly otherOrgs: readonly string[];
  readonly otherPages: readonly number[];
}

/**
 * A self-contained scenario: a target feature/org/page to invalidate plus a set
 * of OTHER orgs and OTHER pages guaranteed distinct from the target, so the
 * "unrelated keys untouched" assertions are meaningful.
 */
const scenarioArb: fc.Arbitrary<Scenario> = fc
  .record({
    feature: featureArb,
    targetOrg: orgIdArb,
    targetPage: pageArb,
    otherOrgs: fc.uniqueArray(orgIdArb, { minLength: 1, maxLength: 3 }),
    otherPages: fc.uniqueArray(pageArb, { minLength: 1, maxLength: 3 }),
  })
  .map((s) => ({
    ...s,
    // Ensure the "other" orgs/pages never collide with the target.
    otherOrgs: s.otherOrgs.filter((o) => o !== s.targetOrg),
    otherPages: s.otherPages.filter((p) => p !== s.targetPage),
  }))
  .filter((s) => s.otherOrgs.length > 0 && s.otherPages.length > 0);

// ---------------------------------------------------------------------------
// Seeding
// ---------------------------------------------------------------------------

/**
 * Seed a diverse cache covering the target plus unrelated features/orgs/pages,
 * and return the full list of seeded keys so the oracle can be checked against
 * each one. Every seeded query starts non-invalidated (`setQueryData`).
 */
function seedCache(queryClient: QueryClient, scenario: Scenario): QueryKey[] {
  const { targetOrg, targetPage, otherOrgs, otherPages } = scenario;
  const keys: QueryKey[] = [];

  const seed = (key: QueryKey): void => {
    keys.push(key);
    queryClient.setQueryData(key, { seededAt: key.join(':') });
  };

  // Target org: every feature, plus the queue + org keys that must NOT be hit by
  // a services/counters/staff mutation.
  seed(queryKeys.services(targetOrg));
  seed(queryKeys.counters(targetOrg));
  seed(queryKeys.staff(targetOrg, targetPage));
  seed(queryKeys.queue(targetOrg));
  seed(queryKeys.org(targetOrg));

  // Target org, OTHER staff pages — must be untouched when invalidating one page.
  for (const page of otherPages) {
    seed(queryKeys.staff(targetOrg, page));
  }

  // OTHER orgs — every feature; must be untouched (org-scoped invalidation).
  for (const org of otherOrgs) {
    seed(queryKeys.services(org));
    seed(queryKeys.counters(org));
    seed(queryKeys.staff(org, targetPage));
    seed(queryKeys.queue(org));
  }

  return keys;
}

/** Read the current invalidation flag for a seeded key from the real client. */
function isInvalidated(queryClient: QueryClient, key: QueryKey): boolean {
  return queryClient.getQueryState(key)?.isInvalidated === true;
}

// ---------------------------------------------------------------------------
// Property 9
// ---------------------------------------------------------------------------

describe("Property 9: successful feature mutations invalidate that feature's query keys", () => {
  afterEach(() => {
    // Nothing global to reset; each case builds its own client. Kept for parity
    // with the other property suites.
  });

  it('invalidates exactly the matching feature/org(/page) queries and leaves unrelated ones untouched', async () => {
    await fc.assert(
      fc.asyncProperty(scenarioArb, async (scenario) => {
        const queryClient = createTestQueryClient();
        const seededKeys = seedCache(queryClient, scenario);

        // Pre-condition: nothing is invalidated before the mutation succeeds.
        for (const key of seededKeys) {
          expect(isInvalidated(queryClient, key)).toBe(false);
        }

        // Build the feature-invalidation target the future mutation hook will use.
        const target: FeatureInvalidation =
          scenario.feature === 'staff'
            ? { feature: 'staff', orgId: scenario.targetOrg, page: scenario.targetPage }
            : { feature: scenario.feature, orgId: scenario.targetOrg };
        const invalidatedKey = featureQueryKey(target);

        // Simulate the mutation's onSuccess.
        await invalidateFeature(queryClient, target);

        // The real client's per-query state must match the independent oracle.
        for (const key of seededKeys) {
          const expected = isPrefixMatch(invalidatedKey, key);
          expect(isInvalidated(queryClient, key)).toBe(expected);
        }

        // Concrete contract checks (Requirements 8.5 / 9.5 / 10.4):
        // 1. The feature's own list key for the target org IS invalidated.
        expect(isInvalidated(queryClient, invalidatedKey)).toBe(true);

        // 2. Unrelated features on the same org are NOT invalidated.
        const sameOrgOtherFeatureKeys: QueryKey[] = [
          queryKeys.services(scenario.targetOrg),
          queryKeys.counters(scenario.targetOrg),
          queryKeys.queue(scenario.targetOrg),
          queryKeys.org(scenario.targetOrg),
        ].filter((key) => !isPrefixMatch(invalidatedKey, key));
        for (const key of sameOrgOtherFeatureKeys) {
          expect(isInvalidated(queryClient, key)).toBe(false);
        }

        // 3. The same feature on every OTHER org is NOT invalidated.
        for (const org of scenario.otherOrgs) {
          const otherOrgKey =
            scenario.feature === 'staff'
              ? queryKeys.staff(org, scenario.targetPage)
              : scenario.feature === 'services'
                ? queryKeys.services(org)
                : queryKeys.counters(org);
          expect(isInvalidated(queryClient, otherOrgKey)).toBe(false);
        }

        // 4. For staff, OTHER pages on the same org are NOT invalidated.
        if (scenario.feature === 'staff') {
          for (const page of scenario.otherPages) {
            expect(isInvalidated(queryClient, queryKeys.staff(scenario.targetOrg, page))).toBe(
              false,
            );
          }
        }

        queryClient.clear();
      }),
      { numRuns: 100 },
    );
  });
});
