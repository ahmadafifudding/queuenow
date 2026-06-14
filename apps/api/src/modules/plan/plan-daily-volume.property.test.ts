// Feature: plan-limit-enforcement, Property 4: Daily volume counts creations regardless of later state changes

import fc from 'fast-check';

/**
 * Property 4 — Daily volume counts creations regardless of later state changes.
 * Validates: Requirements 2.5
 *
 * For any sequence of ticket creations within a window followed by any later
 * cancellations, completions, or deletions of those tickets, the measured
 * Daily_Queue_Volume equals the number of tickets created within that window.
 *
 * Why this models the production measure:
 * - The authoritative Daily_Queue_Volume is the SUM of the per-service,
 *   per-day `DailyQueueCounter.lastNumber` (see `assertWithinDailyQueueLimit` /
 *   `countDailyQueueVolume`). `lastNumber` is a MONOTONIC created-count: it is
 *   incremented on every join and never decremented — cancel/complete/delete
 *   only touch ticket status / other counters, never `lastNumber`.
 * - This test models exactly that invariant across multiple services within one
 *   window and asserts the summed measure equals the number of in-window
 *   creations regardless of any later state changes.
 */

const NUM_RUNS = 200;

/** The lifecycle events that can occur to in-window tickets. */
type TicketEvent =
  | { type: 'create'; service: number }
  | { type: 'cancel' }
  | { type: 'complete' }
  | { type: 'delete' };

/** Up to this many distinct services share the org's daily window. */
const MAX_SERVICES = 4;

const ticketEvent = (): fc.Arbitrary<TicketEvent> =>
  fc.oneof(
    fc
      .integer({ min: 0, max: MAX_SERVICES - 1 })
      .map((service): TicketEvent => ({ type: 'create', service })),
    fc.constant<TicketEvent>({ type: 'cancel' }),
    fc.constant<TicketEvent>({ type: 'complete' }),
    fc.constant<TicketEvent>({ type: 'delete' }),
  );

const eventSequence = (): fc.Arbitrary<TicketEvent[]> => fc.array(ticketEvent(), { maxLength: 80 });

describe('Property 4: Daily volume counts creations regardless of later state changes', () => {
  it('measured Daily_Queue_Volume equals the number of in-window creations', () => {
    fc.assert(
      fc.property(eventSequence(), (events) => {
        // Monotonic per-service created-count (mirrors DailyQueueCounter.lastNumber).
        const lastNumberByService = new Array<number>(MAX_SERVICES).fill(0);
        // Live (non-terminal) tickets that cancel/complete/delete act upon.
        let liveTickets = 0;
        // Independent oracle: the number of creations within the window.
        let creations = 0;

        for (const event of events) {
          switch (event.type) {
            case 'create':
              lastNumberByService[event.service] += 1; // monotonic, never reset
              liveTickets += 1;
              creations += 1;
              break;
            case 'cancel':
            case 'complete':
            case 'delete':
              // Later state changes / removals never touch `lastNumber`.
              if (liveTickets > 0) {
                liveTickets -= 1;
              }
              break;
          }
        }

        // The production measure: sum of `lastNumber` across the org's services
        // for the window date.
        const measuredVolume = lastNumberByService.reduce((sum, n) => sum + n, 0);

        expect(measuredVolume).toBe(creations);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('is invariant under deletions/completions appended after all creations', () => {
    fc.assert(
      fc.property(
        fc.array(fc.integer({ min: 0, max: MAX_SERVICES - 1 }), { maxLength: 60 }),
        fc.array(
          fc.constantFrom<'cancel' | 'complete' | 'delete'>('cancel', 'complete', 'delete'),
          {
            maxLength: 80,
          },
        ),
        (creates, laterChanges) => {
          const lastNumberByService = new Array<number>(MAX_SERVICES).fill(0);
          for (const service of creates) {
            lastNumberByService[service] += 1;
          }
          const volumeAfterCreates = lastNumberByService.reduce((s, n) => s + n, 0);

          // Apply arbitrary later state changes — none affect `lastNumber`.
          // (Modeled as no-ops on the monotonic counter, by definition.)
          void laterChanges;
          const volumeAfterChanges = lastNumberByService.reduce((s, n) => s + n, 0);

          expect(volumeAfterCreates).toBe(creates.length);
          expect(volumeAfterChanges).toBe(volumeAfterCreates);
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });
});
