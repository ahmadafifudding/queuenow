// Feature: customer-mobile-app, Property 2: Discovery join-availability decision
//
// Validates: Requirements 1.3, 1.4
//
// For any discovery resolution outcome, `joinAvailability` decides whether to
// present a join action and how the selection UI behaves:
//
//  - A join action is presented IFF the organization resolved to an active org
//    exposing at least one active service (R1.4). The public status endpoint
//    only ever returns ACTIVE services for an ACTIVE org, so a successful
//    resolution with a non-empty `services` array is exactly that condition.
//  - For an error outcome (resolution failed) — in particular a code in the
//    blocking set `ORG_NOT_FOUND` / `ORG_INACTIVE`, but also any other code —
//    no join action is presented and an error is shown (R1.3).
//  - Service selection is required IFF more than one active service is present;
//    a single active service is auto-selected (R1.4).
//
// `joinAvailability` and `DISCOVERY_BLOCKING_ERROR_CODES` are PURE: the module
// imports only `@queuenow/shared-constants` (ERROR_CODES) and local types, so it
// pulls in no expo-* native modules and needs none of the `vi.mock` stubs the
// client/native tests use.
import { ERROR_CODES } from '@queuenow/shared-constants';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import {
  DISCOVERY_BLOCKING_ERROR_CODES,
  joinAvailability,
} from '@/features/discovery/join-availability';
import type { DiscoveryServiceSummary, JoinAvailabilityInput } from '@/features/discovery/types';

/** Minimum fast-check iterations per property (design requires >= 100). */
const NUM_RUNS = 100;

/** The two canonical discovery blocking codes (R1.3). */
const BLOCKING_CODES = [ERROR_CODES.ORG_NOT_FOUND, ERROR_CODES.ORG_INACTIVE] as const;

/** A spread of OTHER (non-blocking) backend codes — still non-joinable errors. */
const OTHER_ERROR_CODES = [
  ERROR_CODES.SERVICE_NOT_FOUND,
  ERROR_CODES.QUEUE_FULL,
  ERROR_CODES.INTERNAL_ERROR,
  ERROR_CODES.VALIDATION_ERROR,
] as const;

/** A single normalized active service with a unique id. */
const serviceArb = (index: number): fc.Arbitrary<DiscoveryServiceSummary> =>
  fc.record({
    id: fc.constant(`svc-${index}`),
    name: fc.string({ minLength: 1, maxLength: 20 }),
    prefix: fc.string({ minLength: 1, maxLength: 4 }),
    waiting: fc.nat({ max: 500 }),
    estimatedWaitMinutes: fc.nat({ max: 600 }),
  });

/**
 * Generate N active services (N from 0..k) with distinct ids so we can assert
 * which one is auto-selected.
 */
const servicesArb = (max: number): fc.Arbitrary<DiscoveryServiceSummary[]> =>
  fc
    .integer({ min: 0, max })
    .chain((count) =>
      count === 0
        ? fc.constant<DiscoveryServiceSummary[]>([])
        : fc.tuple(...Array.from({ length: count }, (_unused, i) => serviceArb(i))),
    );

/** A successful-resolution input carrying 0..6 active services. */
const successInputArb: fc.Arbitrary<JoinAvailabilityInput> = servicesArb(6).map((services) => ({
  services,
}));

/** An error-resolution input whose code is in the blocking set (R1.3). */
const blockingErrorInputArb: fc.Arbitrary<JoinAvailabilityInput> = fc
  .constantFrom(...BLOCKING_CODES)
  .map((errorCode) => ({ errorCode }));

/** An error-resolution input with some other (non-blocking) code. */
const otherErrorInputArb: fc.Arbitrary<JoinAvailabilityInput> = fc
  .constantFrom(...OTHER_ERROR_CODES)
  .map((errorCode) => ({ errorCode }));

/** Any error outcome (blocking or other). */
const anyErrorInputArb: fc.Arbitrary<JoinAvailabilityInput> = fc.oneof(
  blockingErrorInputArb,
  otherErrorInputArb,
);

/** Any discovery outcome: success (with N services) or an error. */
const anyInputArb: fc.Arbitrary<JoinAvailabilityInput> = fc.oneof(
  successInputArb,
  anyErrorInputArb,
);

describe('Property 2: Discovery join-availability decision', () => {
  it('presents a join action IFF resolution succeeded with >= 1 active service', () => {
    fc.assert(
      fc.property(anyInputArb, (input) => {
        const decision = joinAvailability(input);

        const resolvedActiveWithService = !input.errorCode && (input.services?.length ?? 0) >= 1;

        // The IFF: presentJoinAction is true exactly when an active org exposed
        // at least one active service.
        expect(decision.presentJoinAction).toBe(resolvedActiveWithService);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('shows an error and no join action for any error outcome (blocking codes included)', () => {
    fc.assert(
      fc.property(anyErrorInputArb, (input) => {
        const decision = joinAvailability(input);

        expect(decision.presentJoinAction).toBe(false);
        expect(decision.showError).toBe(true);
        expect(decision.errorCode).toBe(input.errorCode);
        // No services or preselection are surfaced on an error.
        expect(decision.services).toEqual([]);
        expect(decision.preselectedServiceId).toBeNull();
        expect(decision.requiresServiceSelection).toBe(false);
        expect(decision.isEmpty).toBe(false);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('treats the canonical blocking codes as members of DISCOVERY_BLOCKING_ERROR_CODES', () => {
    fc.assert(
      fc.property(blockingErrorInputArb, (input) => {
        const decision = joinAvailability(input);

        expect(DISCOVERY_BLOCKING_ERROR_CODES).toContain(input.errorCode);
        expect(decision.presentJoinAction).toBe(false);
        expect(decision.showError).toBe(true);
        expect(decision.errorCode).toBe(input.errorCode);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('requires service selection IFF more than one active service, else auto-selects the single service', () => {
    fc.assert(
      fc.property(successInputArb, (input) => {
        const decision = joinAvailability(input);
        const services = input.services ?? [];

        if (services.length === 0) {
          // Active org, zero active services → empty state, no join action.
          expect(decision.presentJoinAction).toBe(false);
          expect(decision.isEmpty).toBe(true);
          expect(decision.requiresServiceSelection).toBe(false);
          expect(decision.preselectedServiceId).toBeNull();
          expect(decision.services).toEqual([]);
          return;
        }

        // >= 1 active service → join action presented, services surfaced verbatim.
        expect(decision.presentJoinAction).toBe(true);
        expect(decision.isEmpty).toBe(false);
        expect(decision.showError).toBe(false);
        expect(decision.errorCode).toBeNull();
        expect(decision.services).toEqual(services);

        // requiresServiceSelection IFF more than one active service.
        expect(decision.requiresServiceSelection).toBe(services.length > 1);

        if (services.length > 1) {
          // Multiple services → explicit selection required, nothing preselected.
          expect(decision.preselectedServiceId).toBeNull();
        } else {
          // Exactly one service → auto-selected.
          expect(decision.preselectedServiceId).toBe(services[0]?.id);
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });
});
