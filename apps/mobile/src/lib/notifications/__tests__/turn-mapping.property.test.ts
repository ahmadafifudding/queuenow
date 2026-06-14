// Feature: customer-mobile-app, Property 10: Turn-notification mapping is
// exhaustive and event-driven. For any ticket:notification event, the produced
// turn alert is determined solely by its NotificationType (ALMOST_TURN →
// "almost your turn"; YOUR_TURN → "your turn" including the counter name;
// SKIPPED → "ticket skipped"); and for any sequence of events the number of
// turn alerts produced equals the number of turn-related events consumed — no
// alert is produced without a corresponding event (R5.4).
//
// Validates: Requirements 5.1, 5.2, 5.3, 5.4, 5.6
//
// `manager.ts` statically imports `expo-notifications` (for its default,
// device-wired ports). The pure `turnAlertForEvent` mapping and the
// dependency-injected `createNotificationManager` under test need none of it,
// so we stub the native module to let the real module load under Vitest. The
// in-app banner module only pulls in `zustand` (pure), so it needs no stub.
import { NotificationType } from '@queuenow/shared-types';
import fc from 'fast-check';
import { describe, expect, it, vi } from 'vitest';

vi.mock('expo-notifications', () => ({
  getPermissionsAsync: vi.fn(async () => ({ granted: true })),
  scheduleNotificationAsync: vi.fn(async () => undefined),
}));

import { strings } from '@/i18n';
import {
  createNotificationManager,
  type TicketNotificationEvent,
  type TurnAlert,
  turnAlertForEvent,
} from '@/lib/notifications/manager';
import { createFakeNotificationPorts } from '@/test-support';

/** Minimum fast-check iterations per property (design requires ≥100). */
const NUM_RUNS = 100;

/** The i18n turn-alert catalog the mapping must source its copy from. */
const copy = strings.notifications;

// --- arbitraries -------------------------------------------------------------

/** Every member of the shared `NotificationType` enum, uniformly. */
const notificationTypeArb: fc.Arbitrary<NotificationType> = fc.constantFrom(
  NotificationType.ALMOST_TURN,
  NotificationType.YOUR_TURN,
  NotificationType.SKIPPED,
);

/**
 * Counter names spanning the meaningful cases the mapping distinguishes:
 * absent (`undefined`/`null`), blank/whitespace-only (treated as absent after
 * `trim()`), and real names — including ones with surrounding whitespace and
 * the literal `{counter}` token to guard the interpolation.
 */
const counterNameArb: fc.Arbitrary<string | null | undefined> = fc.oneof(
  fc.constant(undefined),
  fc.constant(null),
  fc.constant(''),
  fc.constant('   '),
  fc.string(),
  fc.string().map((s) => `Counter ${s}`),
  fc.string().map((s) => `  ${s}  `),
);

/** A normalized turn event as the Realtime_Client bridge would hand it over. */
const eventArb: fc.Arbitrary<TicketNotificationEvent> = fc.record({
  type: notificationTypeArb,
  ticketId: fc.option(fc.string(), { nil: undefined }),
  counterName: counterNameArb,
});

// --- oracle ------------------------------------------------------------------

/**
 * Independent oracle for the expected alert copy, derived straight from the
 * catalog + the NotificationType — deliberately NOT calling the production
 * mapping, so the test proves the alert is determined solely by the type
 * (and, for YOUR_TURN, the presence of a counter name).
 */
function expectedAlert(event: TicketNotificationEvent): TurnAlert {
  switch (event.type) {
    case NotificationType.ALMOST_TURN:
      return { type: event.type, title: copy.almostTurnTitle, body: copy.almostTurnBody };
    case NotificationType.YOUR_TURN: {
      const counter = event.counterName?.trim();
      return {
        type: event.type,
        title: copy.yourTurnTitle,
        body: counter
          ? copy.yourTurnBody.replace('{counter}', counter)
          : copy.yourTurnBodyNoCounter,
      };
    }
    case NotificationType.SKIPPED:
      return { type: event.type, title: copy.skippedTitle, body: copy.skippedBody };
    default: {
      const exhaustive: never = event.type;
      throw new Error(`Unhandled notification type: ${String(exhaustive)}`);
    }
  }
}

// --- properties --------------------------------------------------------------

describe('Property 10: Turn-notification mapping is exhaustive and event-driven', () => {
  it('maps every event to the catalog alert determined solely by its NotificationType (R5.1, R5.2, R5.3, R5.6)', () => {
    fc.assert(
      fc.property(eventArb, (event) => {
        const alert = turnAlertForEvent(event);

        // The alert always carries the originating type and the catalog copy
        // for that type — never any backend/free-form text.
        expect(alert).toEqual(expectedAlert(event));
        expect(alert.type).toBe(event.type);

        switch (event.type) {
          case NotificationType.ALMOST_TURN:
            expect(alert.title).toBe(copy.almostTurnTitle);
            expect(alert.body).toBe(copy.almostTurnBody);
            break;
          case NotificationType.SKIPPED:
            expect(alert.title).toBe(copy.skippedTitle);
            expect(alert.body).toBe(copy.skippedBody);
            break;
          case NotificationType.YOUR_TURN: {
            expect(alert.title).toBe(copy.yourTurnTitle);
            const counter = event.counterName?.trim();
            if (counter) {
              // YOUR_TURN identifies the assigned counter (R5.2).
              expect(alert.body).toBe(copy.yourTurnBody.replace('{counter}', counter));
              expect(alert.body).toContain(counter);
            } else {
              // No (usable) counter → the generic "proceed to the counter" copy.
              expect(alert.body).toBe(copy.yourTurnBodyNoCounter);
            }
            break;
          }
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('determines ALMOST_TURN / SKIPPED alerts solely by type, invariant to counterName and ticketId', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(NotificationType.ALMOST_TURN, NotificationType.SKIPPED),
        counterNameArb,
        fc.option(fc.string(), { nil: undefined }),
        (type, counterName, ticketId) => {
          // Same type, arbitrary counter/ticket → identical alert to the
          // minimal event of that type. Counter/ticket cannot leak in.
          const withExtras = turnAlertForEvent({ type, counterName, ticketId });
          const bare = turnAlertForEvent({ type });
          expect(withExtras).toEqual(bare);
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  it('produces exactly one surfaced alert per event and never proactively, for any sequence (R5.4)', async () => {
    await fc.assert(
      fc.asyncProperty(fc.array(eventArb, { maxLength: 30 }), async (events) => {
        // Permission granted + foreground → every alert routes to the OS-local
        // presenter, which records each presented alert.
        const ports = createFakeNotificationPorts({ permissionGranted: true, foreground: true });
        const manager = createNotificationManager(ports.toDeps());

        // Never proactive: constructing the manager surfaces nothing before any
        // event is consumed.
        expect(ports.presented).toHaveLength(0);
        expect(ports.banners).toHaveLength(0);
        expect(ports.playedCount()).toBe(0);

        const channels: string[] = [];
        for (const event of events) {
          channels.push(await manager.handleTicketNotification(event));
        }

        // One alert per event consumed — no more, no fewer (R5.4).
        expect(channels).toHaveLength(events.length);
        expect(channels.every((c) => c === 'os-local-notification')).toBe(true);
        expect(ports.presented).toHaveLength(events.length);

        // Total surfaced alerts across ALL channels equals events consumed:
        // nothing is produced without a corresponding event.
        expect(ports.presented.length + ports.banners.length).toBe(events.length);

        // Each surfaced alert is exactly the pure mapping of its event, in order.
        events.forEach((event, i) => {
          expect(ports.presented[i]).toEqual(turnAlertForEvent(event));
        });
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('still surfaces exactly one alert per event when routed to the in-app banner (denied + foreground)', async () => {
    await fc.assert(
      fc.asyncProperty(fc.array(eventArb, { maxLength: 30 }), async (events) => {
        // Permission denied + foreground → every alert routes to the in-app
        // banner (+ audible). The one-per-event count holds regardless of channel.
        const ports = createFakeNotificationPorts({ permissionGranted: false, foreground: true });
        const manager = createNotificationManager(ports.toDeps());

        for (const event of events) {
          await manager.handleTicketNotification(event);
        }

        expect(ports.presented).toHaveLength(0);
        expect(ports.banners).toHaveLength(events.length);
        expect(ports.playedCount()).toBe(events.length);

        events.forEach((event, i) => {
          const alert = turnAlertForEvent(event);
          expect(ports.banners[i]).toEqual({
            type: alert.type,
            title: alert.title,
            body: alert.body,
          });
        });
      }),
      { numRuns: NUM_RUNS },
    );
  });
});
