// Feature: customer-mobile-app, Property 3: Join request construction and validation —
// for any join inputs (orgId, selected serviceId, optional name/phone, session state),
// the constructed request targets POST /organizations/:orgId/queue/join; always includes
// a non-empty deviceFingerprint; includes customerName/customerPhone exactly when provided;
// includes customerProfileId exactly when signed in; and is sent IFF joinQueueSchema
// validates the body — invalid input never reaches the network.
//
// Validates: Requirements 2.1, 2.2, 2.3, 2.6, 2.7
import fc from 'fast-check';
import { joinQueueSchema } from '@queuenow/shared-validation';
import { describe, expect, it } from 'vitest';

import { buildJoinRequest, joinQueuePath } from '../build-join-request';
import type { BuildJoinRequestInput } from '../types';

/**
 * Independent oracle for the optional-contact normalization rule (R2.2): a value
 * counts as "provided" only when it is a non-blank string. Mirrors the production
 * `normalizeOptional` so the test reasons about presence independently.
 */
function normalizeOptional(value: string | undefined): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

/**
 * Reconstruct the body the production builder would assemble (R2.2, R2.3, R2.6),
 * used as the schema oracle for the send-IFF-valid decision (R2.7).
 */
function expectedBody(input: BuildJoinRequestInput): Record<string, unknown> {
  const body: Record<string, unknown> = {
    serviceId: input.serviceId,
    deviceFingerprint: input.deviceFingerprint,
  };
  const name = normalizeOptional(input.customerName);
  if (name !== undefined) {
    body.customerName = name;
  }
  const phone = normalizeOptional(input.customerPhone);
  if (phone !== undefined) {
    body.customerPhone = phone;
  }
  if (input.isSignedIn && input.customerProfileId) {
    body.customerProfileId = input.customerProfileId;
  }
  return body;
}

/**
 * Generate join inputs that intelligently span the input space:
 *  - serviceId: a mix of valid uuids (schema-valid) and arbitrary strings (schema-invalid)
 *    so the send-IFF-valid decision is exercised in both directions,
 *  - deviceFingerprint: a mix of non-empty, empty, and whitespace-only strings so the
 *    non-empty enforcement (R2.3) is exercised,
 *  - customerName/customerPhone: present (blank or non-blank) or absent (R2.2),
 *  - isSignedIn + customerProfileId: every combination of session state (R2.6).
 */
const inputArb: fc.Arbitrary<BuildJoinRequestInput> = fc.record({
  orgId: fc.string(),
  serviceId: fc.oneof(fc.uuid(), fc.string()),
  deviceFingerprint: fc.oneof(
    fc.string({ minLength: 1 }),
    fc.constant(''),
    fc.constant('   '),
    fc.constant('device-fingerprint-123'),
  ),
  customerName: fc.option(fc.string(), { nil: undefined }),
  customerPhone: fc.option(fc.string(), { nil: undefined }),
  isSignedIn: fc.boolean(),
  customerProfileId: fc.oneof(fc.uuid(), fc.constant(undefined), fc.constant(null)),
});

describe('buildJoinRequest — Property 3: join request construction and validation', () => {
  it('targets the join path, enforces a non-empty fingerprint, includes optional/profile fields exactly when applicable, and is valid IFF the schema validates the body', () => {
    fc.assert(
      fc.property(inputArb, (input) => {
        const expectedPath = `/organizations/${encodeURIComponent(input.orgId)}/queue/join`;

        // R2.1 — the join always targets POST /organizations/:orgId/queue/join.
        expect(joinQueuePath(input.orgId)).toBe(expectedPath);

        const body = expectedBody(input);
        const fingerprintOk =
          typeof body.deviceFingerprint === 'string' && body.deviceFingerprint.trim().length > 0;
        const schemaOk = joinQueueSchema.safeParse(body).success;
        // R2.7 — sent IFF the shared schema validates the body; R2.3 — and the
        // fingerprint is non-empty. Either failure means nothing reaches the network.
        const expectedValid = schemaOk && fingerprintOk;

        const result = buildJoinRequest(input);

        // The valid flag matches the schema oracle (plus the explicit R2.3 rule).
        expect(result.valid).toBe(expectedValid);

        if (result.valid) {
          // R2.1 — the sent request targets the join path.
          expect(result.path).toBe(expectedPath);

          // R2.3 — a sent request ALWAYS carries a non-empty deviceFingerprint.
          expect(typeof result.body.deviceFingerprint).toBe('string');
          expect((result.body.deviceFingerprint ?? '').trim().length).toBeGreaterThan(0);

          // R2.7 — invalid input never reaches the network: the sent body validates.
          expect(joinQueueSchema.safeParse(result.body).success).toBe(true);

          // R2.2 — customerName / customerPhone present EXACTLY when provided.
          const name = normalizeOptional(input.customerName);
          if (name !== undefined) {
            expect(result.body.customerName).toBe(name);
          } else {
            expect('customerName' in result.body).toBe(false);
          }

          const phone = normalizeOptional(input.customerPhone);
          if (phone !== undefined) {
            expect(result.body.customerPhone).toBe(phone);
          } else {
            expect('customerPhone' in result.body).toBe(false);
          }

          // R2.6 — customerProfileId present EXACTLY when signed in (with an id).
          if (input.isSignedIn && input.customerProfileId) {
            expect(result.body.customerProfileId).toBe(input.customerProfileId);
          } else {
            expect('customerProfileId' in result.body).toBe(false);
          }
        } else {
          // R2.7 — an invalid build yields issues and NO sendable request.
          expect(result.issues).toBeDefined();
          expect('path' in result).toBe(false);
          expect('body' in result).toBe(false);
        }
      }),
      { numRuns: 100 },
    );
  });
});
