// Feature: organization-switching, Property 14: Frontend org-scoped cache invalidation
import { QueryClient, type QueryKey } from '@tanstack/react-query';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { invalidateOrgScopedQueries, ORG_SCOPED_PREFIXES } from '@/lib/api/invalidate-org-scoped';
import { queryKeys } from '@/lib/api/query-keys';

/**
 * Property 14 — Frontend org-scoped cache invalidation.
 *
 * For any set of cached query keys, `invalidateOrgScopedQueries` removes exactly
 * the keys whose first element is an org-scoped prefix (`queue`, `services`,
 * `counters`, `staff`, `ticket`, `org-stats`, `organization`, `plan-usage`) and
 * leaves every other key — in particular the user-scoped `['organizations']`
 * membership list — untouched.
 *
 * Validates: Requirements 5.10
 */

/** Design requires >= 100 generated cases. */
const RUNS = 200;

/** Stable string identity for a query key so the cache can be compared as a set. */
function serializeKey(key: QueryKey): string {
  return JSON.stringify(key);
}

/** Small pools so generated keys collide and exercise de-duplication by hash. */
const ORG_IDS = ['org-a', 'org-b', 'org-c'] as const;
const SERVICE_IDS = ['svc-1', 'svc-2'] as const;
const TICKET_IDS = ['t-1', 't-2'] as const;

const orgScopedPrefixSet: ReadonlySet<string> = new Set(ORG_SCOPED_PREFIXES);

/**
 * Generates an org-scoped key straight from the central `queryKeys` factory.
 * Every variant here is keyed by an org id and begins with an org-scoped prefix.
 */
const orgScopedKeyArb = (): fc.Arbitrary<QueryKey> =>
  fc.oneof(
    fc
      .record({ orgId: fc.constantFrom(...ORG_IDS), serviceId: fc.constantFrom(...SERVICE_IDS) })
      .map(({ orgId, serviceId }) => queryKeys.queue(orgId, serviceId)),
    fc.constantFrom(...ORG_IDS).map((orgId) => queryKeys.queue(orgId)),
    fc.constantFrom(...ORG_IDS).map((orgId) => queryKeys.services(orgId)),
    fc.constantFrom(...ORG_IDS).map((orgId) => queryKeys.counters(orgId)),
    fc
      .record({ orgId: fc.constantFrom(...ORG_IDS), page: fc.integer({ min: 1, max: 5 }) })
      .map(({ orgId, page }) => queryKeys.staff(orgId, page)),
    fc
      .record({ orgId: fc.constantFrom(...ORG_IDS), ticketId: fc.constantFrom(...TICKET_IDS) })
      .map(({ orgId, ticketId }) => queryKeys.ticket(orgId, ticketId)),
    fc.constantFrom(...ORG_IDS).map((orgId) => queryKeys.orgStats(orgId)),
    fc.constantFrom(...ORG_IDS).map((orgId) => queryKeys.org(orgId)),
    fc.constantFrom(...ORG_IDS).map((orgId) => queryKeys.planUsage(orgId)),
  );

/**
 * Generates a "foreign" key — any key whose first element is NOT an org-scoped
 * prefix. The user-scoped `['organizations']` membership list is included as a
 * first-class foreign key (it must survive a switch), alongside arbitrary
 * non-org-scoped keys whose first element is guaranteed not to collide with a
 * prefix.
 */
const foreignKeyArb = (): fc.Arbitrary<QueryKey> =>
  fc.oneof(
    // The membership list — explicitly user-scoped, must be untouched.
    fc.constant(queryKeys.organizations() as QueryKey),
    // Arbitrary keys whose first element is never an org-scoped prefix.
    fc
      .record({
        head: fc
          .oneof(
            fc.constantFrom('auth', 'user', 'session', 'theme', 'settings', 'organizations'),
            fc.string(),
          )
          .filter((s) => !orgScopedPrefixSet.has(s)),
        tail: fc.array(fc.oneof(fc.string(), fc.integer(), fc.constant(undefined)), {
          maxLength: 3,
        }),
      })
      .map(({ head, tail }) => [head, ...tail] as QueryKey),
  );

describe('Property 14: org-scoped cache invalidation', () => {
  it('removes exactly the org-scoped-prefixed keys and leaves all other keys untouched', () => {
    fc.assert(
      fc.property(
        fc.array(orgScopedKeyArb(), { maxLength: 12 }),
        fc.array(foreignKeyArb(), { maxLength: 12 }),
        (orgScopedKeys, foreignKeys) => {
          const queryClient = new QueryClient();

          // Seed the cache with a mix of org-scoped factory keys, the
          // user-scoped `['organizations']` list, and random foreign keys.
          // `['organizations']` is always seeded so we can assert it survives.
          const seeded: QueryKey[] = [
            ...orgScopedKeys,
            ...foreignKeys,
            queryKeys.organizations() as QueryKey,
          ];
          seeded.forEach((key, index) => {
            queryClient.setQueryData(key, { value: index });
          });

          // Expected survivors: every seeded key whose first element is NOT an
          // org-scoped prefix (de-duplicated by serialized identity).
          const expectedSurvivors = new Set(
            seeded.filter((key) => !orgScopedPrefixSet.has(key[0] as string)).map(serializeKey),
          );

          invalidateOrgScopedQueries(queryClient);

          const remaining = new Set(
            queryClient
              .getQueryCache()
              .getAll()
              .map((query) => serializeKey(query.queryKey)),
          );

          // Exactly the non-org-scoped keys remain — no more, no fewer.
          expect(remaining).toEqual(expectedSurvivors);

          // No surviving key begins with an org-scoped prefix.
          for (const query of queryClient.getQueryCache().getAll()) {
            expect(orgScopedPrefixSet.has(query.queryKey[0] as string)).toBe(false);
          }

          // The user-scoped membership list is always present afterward.
          expect(remaining.has(serializeKey(queryKeys.organizations()))).toBe(true);

          queryClient.clear();
        },
      ),
      { numRuns: RUNS },
    );
  });
});
