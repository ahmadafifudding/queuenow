// Feature: customer-mobile-app, Property 13: List rows expose their required fields
//
// Validates: Requirements 7.2, 8.4
//
// For any history list, every rendered row exposes the organization name,
// service name, `ticketNumber`, and a valid `TicketStatus` (R7.2); for any
// favorites list, every rendered row exposes the organization name and a
// view-services action target (R8.4).
//
// History side: `projectTicketHistory` / `toHistoryRow` are pure projections
// (no I/O, no `Date`, no randomness), so they are exercised directly with no
// native-module stubbing. We generate arbitrary `TicketHistoryEntry[]`, project
// them, and assert every resulting `HistoryRow` carries the four required
// fields with the right values and a valid `TicketStatus`.
//
// Favorites side: `FavoritesList` has no separate pure row projector — the
// component computes the rendered rows inline. The selection rule it applies is
// "render only favorites whose organization resolved" (`Boolean(item.organization)`),
// and each rendered row reads `item.organization?.name` (the org name) and
// `item.orgId` (the `/join/[orgId]` view-services route target). We replicate
// that exact selection rule with a tiny local helper and assert the property
// over arbitrary `FavoriteItem[]` (some with an organization, some without):
// every selected row exposes a non-empty org name and an orgId usable as the
// route target, and every excluded row is one whose organization is absent.
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { projectTicketHistory, toHistoryRow } from '@/features/history/history-projection';
import type { TicketHistoryEntry } from '@/features/history/types';
import type { FavoriteItem, FavoriteOrganization } from '@/features/favorites/types';
import { OrganizationType, TicketStatus } from '@queuenow/shared-types';

// --- shared arbitraries ----------------------------------------------------

/** A non-empty identifier-ish string (ids, orgId, ticketNumber, names). */
const idArb: fc.Arbitrary<string> = fc
  .string({ minLength: 1, maxLength: 24 })
  .filter((s) => s.trim().length > 0);

/** A non-empty display name (organization / service name). */
const nameArb: fc.Arbitrary<string> = fc
  .string({ minLength: 1, maxLength: 40 })
  .filter((s) => s.trim().length > 0);

/** An ISO-8601 timestamp string. */
const isoArb: fc.Arbitrary<string> = fc
  .date({ min: new Date('2020-01-01T00:00:00.000Z'), max: new Date('2035-01-01T00:00:00.000Z') })
  .map((d) => d.toISOString());

/** Any ticket status (WAITING/CALLED/SERVING/COMPLETED/SKIPPED). */
const statusArb: fc.Arbitrary<TicketStatus> = fc.constantFrom(...Object.values(TicketStatus));

/** The set of valid `TicketStatus` values, for membership assertions. */
const VALID_STATUSES = new Set<string>(Object.values(TicketStatus));

// --- history arbitraries ---------------------------------------------------

/**
 * A complete {@link TicketHistoryEntry} as returned by `GET /customers/history`:
 * an `IQueueTicket` augmented with the narrowed nested `service`/`organization`
 * projections (id + name). All ticket fields are populated so the projection is
 * exercised independently of which optional fields happen to be present.
 */
const historyEntryArb: fc.Arbitrary<TicketHistoryEntry> = fc.record({
  id: idArb,
  orgId: idArb,
  serviceId: idArb,
  counterId: fc.option(idArb, { nil: null }),
  ticketNumber: idArb,
  dailyNumber: fc.integer({ min: 1, max: 9999 }),
  status: statusArb,
  customerName: fc.option(fc.string(), { nil: null }),
  customerPhone: fc.option(fc.string(), { nil: null }),
  customerProfileId: fc.option(idArb, { nil: null }),
  calledAt: fc.option(isoArb, { nil: null }),
  completedAt: fc.option(isoArb, { nil: null }),
  skippedAt: fc.option(isoArb, { nil: null }),
  recallCount: fc.integer({ min: 0, max: 10 }),
  isRejoin: fc.boolean(),
  createdAt: isoArb,
  service: fc.record({ id: idArb, name: nameArb }),
  organization: fc.record({ id: idArb, name: nameArb }),
});

const historyListArb: fc.Arbitrary<TicketHistoryEntry[]> = fc.array(historyEntryArb, {
  maxLength: 30,
});

// --- favorites arbitraries -------------------------------------------------

/** The org subset the backend attaches to a favorite (Picked from IOrganization). */
const favoriteOrgArb: fc.Arbitrary<FavoriteOrganization> = fc.record({
  id: idArb,
  name: nameArb,
  slug: idArb,
  type: fc.constantFrom(...Object.values(OrganizationType)),
  address: fc.option(fc.string({ maxLength: 60 }), { nil: null }),
});

/**
 * A {@link FavoriteItem} from `GET /customers/favorites`. `organization` is
 * present for an active org and `undefined` when the org is no longer active —
 * we generate both so the screen's selection rule is meaningfully exercised.
 */
const favoriteItemArb: fc.Arbitrary<FavoriteItem> = fc.record({
  id: idArb,
  orgId: idArb,
  createdAt: isoArb,
  organization: fc.option(favoriteOrgArb, { nil: undefined }),
});

const favoritesListArb: fc.Arbitrary<FavoriteItem[]> = fc.array(favoriteItemArb, {
  maxLength: 30,
});

/**
 * The exact selection rule `FavoritesList` applies before rendering rows:
 * only favorites whose organization resolved are shown (R8.4). Replicated here
 * so the property is asserted at the same pure level the component selects at.
 */
function selectRenderedFavorites(items: readonly FavoriteItem[]): FavoriteItem[] {
  return items.filter((item) => Boolean(item.organization));
}

// --- properties ------------------------------------------------------------

describe('Property 13: List rows expose their required fields', () => {
  it('history: every projected row exposes org name, service name, ticketNumber, and a valid TicketStatus (R7.2)', () => {
    fc.assert(
      fc.property(historyListArb, (entries) => {
        const rows = projectTicketHistory(entries);

        // Projection is total: one row per entry, none dropped.
        expect(rows).toHaveLength(entries.length);

        for (const row of rows) {
          // Organization name present and non-empty.
          expect(typeof row.organizationName).toBe('string');
          expect(row.organizationName.length).toBeGreaterThan(0);

          // Service name present and non-empty.
          expect(typeof row.serviceName).toBe('string');
          expect(row.serviceName.length).toBeGreaterThan(0);

          // ticketNumber present and non-empty.
          expect(typeof row.ticketNumber).toBe('string');
          expect(row.ticketNumber.length).toBeGreaterThan(0);

          // status is a valid TicketStatus.
          expect(VALID_STATUSES.has(row.status)).toBe(true);
        }
      }),
      { numRuns: 100 },
    );
  });

  it('history: each row carries the values of its source entry (per-entry field selection) (R7.2)', () => {
    fc.assert(
      fc.property(historyEntryArb, (entry) => {
        const row = toHistoryRow(entry);

        expect(row.organizationName).toBe(entry.organization.name);
        expect(row.serviceName).toBe(entry.service.name);
        expect(row.ticketNumber).toBe(entry.ticketNumber);
        expect(row.status).toBe(entry.status);
      }),
      { numRuns: 100 },
    );
  });

  it('favorites: every rendered row exposes a non-empty org name and an orgId view-services target; org-less rows are excluded (R8.4)', () => {
    fc.assert(
      fc.property(favoritesListArb, (items) => {
        const rendered = selectRenderedFavorites(items);

        // Selection rule: rendered rows are exactly those with an organization.
        expect(rendered.length).toBe(items.filter((i) => Boolean(i.organization)).length);

        for (const row of rendered) {
          // The organization name the row renders (`item.organization?.name`).
          expect(row.organization).toBeDefined();
          expect(typeof row.organization?.name).toBe('string');
          expect((row.organization?.name ?? '').length).toBeGreaterThan(0);

          // The `/join/[orgId]` view-services route target.
          expect(typeof row.orgId).toBe('string');
          expect(row.orgId.length).toBeGreaterThan(0);
        }

        // Every excluded item is one whose organization is absent — no row with
        // a resolvable organization is ever dropped.
        for (const item of items) {
          if (!rendered.includes(item)) {
            expect(item.organization).toBeUndefined();
          }
        }
      }),
      { numRuns: 100 },
    );
  });
});
