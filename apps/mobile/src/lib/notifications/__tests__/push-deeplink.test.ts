// Feature: customer-mobile-app, Task 6.5 example test
//
// Verify: a delivered push payload for an Active_Ticket resolves to the
// `/ticket/[orgId]/[ticketId]` route on activation (R13.3). The route mapping
// lives in the PURE `routeForPushPayload(data)` helper, which resolves a route
// ONLY when BOTH a non-empty `orgId` and a non-empty `ticketId` are present and
// returns `null` otherwise (missing/empty ids, or a non-object payload).
//
// Validates: Requirements 13.3
//
// `push.ts` statically imports device-wired modules for its default ports
// (`expo-notifications`, `expo-router`) and transitively pulls in the REST
// client → `expo-secure-store` (via secure-store) and `expo-constants` (via
// env). The pure `routeForPushPayload` under test needs none of them, so we
// stub these native modules to let the real module load under Vitest (same
// pattern as the channel-selection / turn-mapping property tests).
import fc from 'fast-check';
import { describe, expect, it, vi } from 'vitest';

vi.mock('expo-notifications', () => ({
  getPermissionsAsync: vi.fn(async () => ({ granted: true })),
  getExpoPushTokenAsync: vi.fn(async () => ({ data: 'ExponentPushToken[stub]' })),
  addNotificationResponseReceivedListener: vi.fn(() => ({ remove: vi.fn() })),
}));

vi.mock('expo-router', () => ({
  router: { push: vi.fn() },
}));

vi.mock('expo-secure-store', () => ({
  getItemAsync: vi.fn(async () => null),
  setItemAsync: vi.fn(async () => undefined),
  deleteItemAsync: vi.fn(async () => undefined),
}));

vi.mock('expo-constants', () => ({
  default: { expoConfig: { extra: {} } },
}));

import { routeForPushPayload } from '@/lib/notifications/push';

/** Minimum fast-check iterations for the supplementary property check. */
const NUM_RUNS = 100;

describe('Task 6.5: push payload deep-linking (routeForPushPayload, R13.3)', () => {
  it('resolves an Active_Ticket payload to /ticket/<orgId>/<ticketId> on activation', () => {
    // The guaranteed-coverage case (R13.3): a delivered push for an
    // Active_Ticket carrying both ids deep-links to the active-ticket route.
    expect(
      routeForPushPayload({ orgId: 'org-123', ticketId: 'ticket-456', type: 'YOUR_TURN' }),
    ).toBe('/ticket/org-123/ticket-456');
  });

  it('builds the route from the exact orgId/ticketId values (representative cases)', () => {
    expect(routeForPushPayload({ orgId: 'acme', ticketId: 'A-007', type: 'ALMOST_TURN' })).toBe(
      '/ticket/acme/A-007',
    );
    expect(
      routeForPushPayload({
        orgId: 'b3b3f0a2-1111-4c2a-9aaa-000000000001',
        ticketId: 'b3b3f0a2-2222-4c2a-9aaa-000000000002',
        type: 'SKIPPED',
      }),
    ).toBe('/ticket/b3b3f0a2-1111-4c2a-9aaa-000000000001/b3b3f0a2-2222-4c2a-9aaa-000000000002');
  });

  it('trims surrounding whitespace on the ids before building the route', () => {
    expect(routeForPushPayload({ orgId: '  org-1  ', ticketId: '  t-9  ' })).toBe(
      '/ticket/org-1/t-9',
    );
  });

  it('ignores extra payload fields (type and others do not affect the route)', () => {
    expect(
      routeForPushPayload({
        orgId: 'org-x',
        ticketId: 't-x',
        type: 'YOUR_TURN',
        counterName: 'Counter 3',
        extra: { nested: true },
      }),
    ).toBe('/ticket/org-x/t-x');
  });

  describe('returns null when the route cannot be resolved (R13.3)', () => {
    it.each([
      ['orgId missing', { ticketId: 't-1', type: 'YOUR_TURN' }],
      ['ticketId missing', { orgId: 'org-1', type: 'YOUR_TURN' }],
      ['both missing', { type: 'YOUR_TURN' }],
      ['orgId empty string', { orgId: '', ticketId: 't-1' }],
      ['ticketId empty string', { orgId: 'org-1', ticketId: '' }],
      ['orgId whitespace only', { orgId: '   ', ticketId: 't-1' }],
      ['ticketId whitespace only', { orgId: 'org-1', ticketId: '   ' }],
      ['orgId not a string', { orgId: 123, ticketId: 't-1' }],
      ['ticketId not a string', { orgId: 'org-1', ticketId: 456 }],
      ['orgId null', { orgId: null, ticketId: 't-1' }],
      ['empty object', {}],
    ])('%s -> null', (_label, payload) => {
      expect(routeForPushPayload(payload)).toBeNull();
    });

    it.each([
      ['null', null],
      ['undefined', undefined],
      ['number', 42],
      ['string', '/ticket/org-1/t-1'],
      ['boolean', true],
      ['array', ['org-1', 't-1']],
    ])('non-object payload (%s) -> null', (_label, payload) => {
      expect(routeForPushPayload(payload as unknown)).toBeNull();
    });
  });

  // Supplementary property check (trivial): for any non-empty orgId/ticketId,
  // the resolved route round-trips the trimmed ids in the exact pattern.
  it('property: any non-empty orgId/ticketId yields /ticket/<orgId>/<ticketId>', () => {
    const idArb = fc
      .string({ minLength: 1, maxLength: 24 })
      // Constrain to ids whose trimmed form is non-empty and contains no slash,
      // so the resolved route segments are unambiguous.
      .filter((s) => s.trim().length > 0 && !s.includes('/'));

    fc.assert(
      fc.property(idArb, idArb, (orgId, ticketId) => {
        const route = routeForPushPayload({ orgId, ticketId, type: 'YOUR_TURN' });
        expect(route).toBe(`/ticket/${orgId.trim()}/${ticketId.trim()}`);
      }),
      { numRuns: NUM_RUNS },
    );
  });
});
