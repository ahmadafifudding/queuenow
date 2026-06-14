// Feature: customer-mobile-app, Property 18: Offline cache round-trip, staleness, and live-action gating
//
// Validates: Requirements 9.1, 9.2, 9.5
//
// For any loaded Active_Ticket this property captures the whole offline story
// the design pins to `persist.ts` + `connectivity.ts`:
//
//   - Round-trip (R9.1): the read-only active-ticket cache, built over the
//     in-memory AsyncStorage adapter, persists a record and reads it back
//     byte-for-byte equal — the read-back `{ orgId, ticket, cachedAt }` deep-
//     equals exactly what `write` returned. Corrupt, missing, or structurally
//     invalid stored values read back as `null` ("no usable cache") rather than
//     throwing, so the tracking screen can fall back uniformly.
//   - Staleness + gating (R9.2, R9.5): the pure connectivity derivations decide
//     online-ness and the staleness/gating signals. `deriveOnline` follows the
//     rule (connected AND not explicitly unreachable); and driving the
//     connectivity store with a generated online value yields exactly:
//     `mayBeOutOfDate === !online`, `liveActionsDisabled === !online`, and a
//     `liveActionDisabledReason` that is the centralized i18n string when
//     offline and `null` when online. Live actions are thus enabled IFF online.
//
// `connectivity.ts` statically imports the `react-native` `AppState` module and
// `@react-native-community/netinfo`, and `persist.ts` imports
// `@react-native-async-storage/async-storage`. Those native packages ship
// Flow-typed source that Vitest's transform cannot parse, and none of them are
// exercised by this property (the cache gets an injected in-memory adapter and
// the store's pure derivations are driven directly). Stub the native boundary so
// the REAL pure logic under test loads; nothing about the behavior is faked.
import fc from 'fast-check';
import { describe, expect, it, vi } from 'vitest';

vi.mock('react-native', () => ({
  AppState: {
    currentState: 'active',
    addEventListener: () => ({ remove: () => {} }),
  },
}));
vi.mock('@react-native-community/netinfo', () => ({
  default: {
    fetch: async () => ({ isConnected: true, isInternetReachable: true }),
    addEventListener: () => () => {},
  },
}));
vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: async () => null,
    setItem: async () => undefined,
    removeItem: async () => undefined,
  },
}));

import { ACTIVE_TICKET_CACHE_KEY, createActiveTicketCache } from '@/lib/api/persist';
import { connectivityStore, deriveOnline, type NetInfoSnapshot } from '@/lib/connectivity';
import { strings } from '@/i18n';
import type { TicketStatusView } from '@/lib/view-models';
import { createInMemoryAsyncStorage } from '@/test-support';
import { TicketStatus } from '@queuenow/shared-types';

// --- arbitraries -----------------------------------------------------------

/** A non-empty identifier-ish string (orgId, serviceId, ticket id, …). */
const idArb: fc.Arbitrary<string> = fc
  .string({ minLength: 1, maxLength: 24 })
  .filter((s) => s.trim().length > 0);

/** Any ticket status. */
const statusArb: fc.Arbitrary<TicketStatus> = fc.constantFrom(...Object.values(TicketStatus));

/** An ISO-8601 timestamp string, JSON-stable. */
const isoArb: fc.Arbitrary<string> = fc
  .date({ min: new Date('2020-01-01T00:00:00.000Z'), max: new Date('2035-01-01T00:00:00.000Z') })
  .map((d) => d.toISOString());

/** A live integer field (`position`/`estimatedWaitMinutes`) or `null`. */
const liveNumberArb: fc.Arbitrary<number | null> = fc.option(fc.integer({ min: 0, max: 9999 }), {
  nil: null,
});

/**
 * A complete, JSON-stable {@link TicketStatusView}. Composes the shared
 * `IQueueTicket` fields with the backend-computed live fields and the optional
 * counter/service augmentations. Optionals use `null`/omission so the value
 * survives a JSON round-trip unchanged.
 */
const ticketArb: fc.Arbitrary<TicketStatusView> = fc.record({
  id: idArb,
  orgId: idArb,
  serviceId: idArb,
  counterId: fc.option(idArb, { nil: null }),
  ticketNumber: fc.string({ minLength: 1, maxLength: 8 }),
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
  position: liveNumberArb,
  estimatedWaitMinutes: liveNumberArb,
  counter: fc.option(fc.record({ id: idArb, name: fc.string({ minLength: 1 }) }), { nil: null }),
});

/** A NetInfo snapshot exploring all connected/reachable combinations. */
const snapshotArb: fc.Arbitrary<NetInfoSnapshot> = fc.record({
  isConnected: fc.constantFrom<boolean | null>(true, false, null),
  isInternetReachable: fc.constantFrom<boolean | null>(true, false, null),
});

/**
 * A raw stored value that is NOT a valid `CachedActiveTicket`: unparseable JSON,
 * or well-formed JSON whose shape fails the structural guard (wrong type,
 * missing required fields, etc.). Each must read back as `null`.
 */
const corruptRawArb: fc.Arbitrary<string> = fc.oneof(
  fc.constantFrom(
    'not json {',
    '',
    '   ',
    '}{',
    'null',
    'true',
    '42',
    '"a bare string"',
    '[]',
    '[1,2,3]',
    '{}',
    '{"orgId":123,"ticket":{},"cachedAt":"2020-01-01T00:00:00.000Z"}', // orgId not a string
    '{"orgId":"o","cachedAt":"2020-01-01T00:00:00.000Z"}', // missing ticket
    '{"orgId":"o","ticket":{},"cachedAt":123}', // cachedAt not a string
    '{"orgId":"o","ticket":null,"cachedAt":"2020-01-01T00:00:00.000Z"}', // ticket null
  ),
  // Any JSON value that is not an object-with-the-required-string-fields.
  fc
    .jsonValue()
    .map((v) => JSON.stringify(v))
    .filter((raw) => {
      try {
        const parsed: unknown = JSON.parse(raw);
        if (typeof parsed !== 'object' || parsed === null) return true;
        const rec = parsed as Record<string, unknown>;
        return !(
          typeof rec.orgId === 'string' &&
          typeof rec.cachedAt === 'string' &&
          typeof rec.ticket === 'object' &&
          rec.ticket !== null
        );
      } catch {
        return true;
      }
    }),
);

// --- properties ------------------------------------------------------------

describe('Property 18: Offline cache round-trip, staleness, and action gating', () => {
  it('round-trips any (orgId, TicketStatusView): read-back deep-equals the written record (R9.1)', async () => {
    await fc.assert(
      fc.asyncProperty(idArb, ticketArb, isoArb, async (orgId, ticket, cachedAtIso) => {
        const storage = createInMemoryAsyncStorage();
        const cache = createActiveTicketCache(storage);

        // Deterministic timestamp so `cachedAt` is asserted exactly.
        const written = await cache.write(orgId, ticket, () => new Date(cachedAtIso));

        // The written record reflects exactly what we asked to cache.
        expect(written.orgId).toBe(orgId);
        expect(written.ticket).toEqual(ticket);
        expect(written.cachedAt).toBe(cachedAtIso);

        // Read-back deep-equals the written record across orgId, ticket, cachedAt.
        const readBack = await cache.read();
        expect(readBack).toEqual(written);
        expect(readBack).toEqual({ orgId, ticket, cachedAt: cachedAtIso });
      }),
      { numRuns: 100 },
    );
  });

  it('reads back null when nothing is cached (R9.1)', async () => {
    const storage = createInMemoryAsyncStorage();
    const cache = createActiveTicketCache(storage);
    expect(await cache.read()).toBeNull();
  });

  it('reads back null for any corrupt/structurally-invalid stored value (R9.1)', async () => {
    await fc.assert(
      fc.asyncProperty(corruptRawArb, async (raw) => {
        const storage = createInMemoryAsyncStorage();
        storage.seed(ACTIVE_TICKET_CACHE_KEY, raw);
        const cache = createActiveTicketCache(storage);
        expect(await cache.read()).toBeNull();
      }),
      { numRuns: 100 },
    );
  });

  it('clear() removes the cached ticket so a subsequent read is null (R9.1)', async () => {
    await fc.assert(
      fc.asyncProperty(idArb, ticketArb, async (orgId, ticket) => {
        const storage = createInMemoryAsyncStorage();
        const cache = createActiveTicketCache(storage);
        await cache.write(orgId, ticket);
        await cache.clear();
        expect(await cache.read()).toBeNull();
      }),
      { numRuns: 100 },
    );
  });

  it('deriveOnline follows the connectivity rule for any NetInfo snapshot (R9.2)', () => {
    fc.assert(
      fc.property(snapshotArb, (snapshot) => {
        const expected = snapshot.isConnected === true && snapshot.isInternetReachable !== false;
        expect(deriveOnline(snapshot)).toBe(expected);
      }),
      { numRuns: 100 },
    );
  });

  it('staleness + live-action gating are derived from online-ness; actions enabled IFF online (R9.2, R9.5)', () => {
    fc.assert(
      fc.property(fc.boolean(), (online) => {
        connectivityStore.getState().setOnline(online);
        const state = connectivityStore.getState();

        expect(state.isOnline).toBe(online);

        // Staleness indicator shows exactly while offline (R9.2).
        expect(state.mayBeOutOfDate).toBe(!online);

        // Live actions disabled exactly while offline (R9.5) — enabled IFF online.
        expect(state.liveActionsDisabled).toBe(!online);

        // The disabled reason is the centralized i18n string when offline and
        // null when online — never a hardcoded literal (R9.5).
        if (online) {
          expect(state.liveActionDisabledReason).toBeNull();
        } else {
          expect(state.liveActionDisabledReason).toBe(strings.offline.actionUnavailable);
        }
      }),
      { numRuns: 100 },
    );
  });
});
