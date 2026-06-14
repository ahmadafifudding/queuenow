// Feature: customer-mobile-app, Property 17: Account data isolation when signed out
//
// Validates: Requirements 7.4
//
// For any previously-cached account data (history, favorites, notifications),
// while signed out the corresponding view exposes zero entries and the
// account-scoped query cache holds no entries.
//
// The pure target is `clearAccountScopedQueries` (the sign-out cleanup the Auth
// Manager calls — see `auth-manager.ts#signOut`) composed with the `queryKeys`
// factory. We seed a REAL `QueryClient` (via the test-support
// `createTestQueryClient`) with arbitrary generated payloads under
// `queryKeys.history()` / `favorites()` / `notifications()`, plus arbitrary
// UNRELATED keys (`orgStatus`, `ticket`) that MUST survive sign-out. After
// `clearAccountScopedQueries`, we assert:
//   - `getQueryData` for each account key is `undefined` (removed) — a view
//     reading the cache therefore exposes zero entries (R7.4);
//   - the account-scoped query cache holds no matching entries; and
//   - every unrelated key retains its exact cached value (sign-out scopes its
//     removal to account data only).
//
// `invalidation.ts` and `query-keys.ts` import nothing native, so no expo stubs
// are required and the real production logic under test loads directly.
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { clearAccountScopedQueries } from '@/lib/api/invalidation';
import { queryKeys } from '@/lib/api/query-keys';
import { createTestQueryClient } from '@/test-support';

// --- arbitraries -----------------------------------------------------------

/** A non-empty identifier string (org / service / ticket ids). */
const idArb: fc.Arbitrary<string> = fc
  .hexaString({ minLength: 4, maxLength: 12 })
  .map((s) => `id_${s}`);

/**
 * An arbitrary account-scoped payload: usually a list of opaque JSON entries
 * (history rows / favorites / notifications), but also occasionally an empty
 * list or a non-array shape, since the cache is payload-agnostic and the
 * property is about REMOVAL, not the payload shape.
 */
const accountPayloadArb: fc.Arbitrary<unknown> = fc.oneof(
  fc.array(fc.jsonValue(), { maxLength: 8 }),
  fc.jsonValue(),
);

/** Whether a given account key was previously cached at all. */
type AccountSeed = {
  history: { present: boolean; data: unknown };
  favorites: { present: boolean; data: unknown };
  notifications: { present: boolean; data: unknown };
};

const accountSeedArb: fc.Arbitrary<AccountSeed> = fc.record({
  history: fc.record({ present: fc.boolean(), data: accountPayloadArb }),
  favorites: fc.record({ present: fc.boolean(), data: accountPayloadArb }),
  notifications: fc.record({ present: fc.boolean(), data: accountPayloadArb }),
});

/** An unrelated cache entry that must SURVIVE sign-out (org status or a ticket). */
type Survivor =
  | { kind: 'orgStatus'; orgId: string; serviceId?: string; data: unknown }
  | { kind: 'ticket'; orgId: string; ticketId: string; data: unknown };

const survivorArb: fc.Arbitrary<Survivor> = fc.oneof(
  fc.record({
    kind: fc.constant<'orgStatus'>('orgStatus'),
    orgId: idArb,
    serviceId: fc.option(idArb, { nil: undefined }),
    data: fc.jsonValue(),
  }),
  fc.record({
    kind: fc.constant<'ticket'>('ticket'),
    orgId: idArb,
    ticketId: idArb,
    data: fc.jsonValue(),
  }),
);

const survivorsArb: fc.Arbitrary<Survivor[]> = fc.array(survivorArb, { maxLength: 6 });

/** Resolve the query key for a survivor through the production factory. */
function survivorKey(s: Survivor): readonly unknown[] {
  return s.kind === 'orgStatus'
    ? queryKeys.orgStatus(s.orgId, s.serviceId)
    : queryKeys.ticket(s.orgId, s.ticketId);
}

// --- property --------------------------------------------------------------

describe('Property 17: Account data isolation when signed out', () => {
  it('removes all account-scoped cache entries (history/favorites/notifications) on sign-out while leaving unrelated cache entries intact', () => {
    fc.assert(
      fc.property(accountSeedArb, survivorsArb, (account, survivors) => {
        const queryClient = createTestQueryClient();

        // Seed the account-scoped keys that were "previously cached".
        if (account.history.present) {
          queryClient.setQueryData(queryKeys.history(), account.history.data);
        }
        if (account.favorites.present) {
          queryClient.setQueryData(queryKeys.favorites(), account.favorites.data);
        }
        if (account.notifications.present) {
          queryClient.setQueryData(queryKeys.notifications(), account.notifications.data);
        }

        // Seed unrelated entries that must survive sign-out. Later survivors with
        // an identical key overwrite earlier ones, so resolve the expected value
        // per unique key from the final seeded state.
        for (const s of survivors) {
          queryClient.setQueryData(survivorKey(s), s.data);
        }
        const expectedSurvivors = new Map<string, unknown>();
        for (const s of survivors) {
          const key = survivorKey(s);
          expectedSurvivors.set(JSON.stringify(key), queryClient.getQueryData(key));
        }

        // Act: sign-out cleanup.
        clearAccountScopedQueries(queryClient);

        // 1) The account-scoped views expose zero entries: the cache no longer
        //    holds any value under those keys.
        expect(queryClient.getQueryData(queryKeys.history())).toBeUndefined();
        expect(queryClient.getQueryData(queryKeys.favorites())).toBeUndefined();
        expect(queryClient.getQueryData(queryKeys.notifications())).toBeUndefined();

        // 2) The account-scoped query cache holds no entries for those keys.
        const cache = queryClient.getQueryCache();
        expect(cache.findAll({ queryKey: queryKeys.history() })).toHaveLength(0);
        expect(cache.findAll({ queryKey: queryKeys.favorites() })).toHaveLength(0);
        expect(cache.findAll({ queryKey: queryKeys.notifications() })).toHaveLength(0);

        // 3) Unrelated entries are untouched: removal is scoped to account data.
        for (const [serializedKey, expectedValue] of expectedSurvivors) {
          const key = JSON.parse(serializedKey) as readonly unknown[];
          expect(queryClient.getQueryData(key)).toEqual(expectedValue);
        }

        queryClient.clear();
      }),
      { numRuns: 100 },
    );
  });
});
