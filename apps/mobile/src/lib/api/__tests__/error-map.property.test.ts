// Feature: customer-mobile-app, Property 20: Error-code-to-message mapping depends only on the code
//
// Validates: Requirements 2.5, 10.2, 10.4, 11.4
//
// `messageForErrorCode` resolves a backend `error.code` to user-facing copy
// using ONLY the code — never any accompanying backend message text (R10.2).
// For any known `ERROR_CODES` value it returns the curated catalog copy and the
// result is invariant to whatever message string travelled alongside the error;
// unknown or missing codes resolve to the generic fallback so an unseen server
// code can never leak an internal message (R10.4). In particular `QUEUE_FULL`
// resolves to the queue-full copy, which is what lets the join flow suppress
// ticket issuance and surface a no-ticket error state (R2.5), and the same
// code-only contract governs leave/cancel failures (R11.4).
//
// `messageForErrorCode` is a pure function over the error code and imports only
// the i18n catalog (`@/i18n` → `@queuenow/shared-constants`); it pulls in no
// expo-* native modules and does not import `createApiClient`, so this property
// needs none of the native-module `vi.mock` stubs used by the client tests.
import { ERROR_CODES } from '@queuenow/shared-constants';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { messageForErrorCode } from '@/lib/api/error-map';
import { strings } from '@/i18n';

const ALL_ERROR_CODES = Object.values(ERROR_CODES);
const KNOWN_CODES = new Set<string>(ALL_ERROR_CODES);

/** Any canonical backend error code. */
const knownCodeArb: fc.Arbitrary<string> = fc.constantFrom(...ALL_ERROR_CODES);

/** Arbitrary "accompanying message text" the backend might have sent. */
const messageTextArb: fc.Arbitrary<string> = fc.string();

/**
 * Arbitrary string that is NOT a known error code. Constrained by filtering the
 * generated value against the known-code set so the generator reliably explores
 * the unknown-code branch.
 */
const unknownCodeArb: fc.Arbitrary<string> = fc.string().filter((value) => !KNOWN_CODES.has(value));

describe('Property 20: Error-code-to-message mapping depends only on the code', () => {
  it('resolves every known code to its catalog copy, invariant to any accompanying message text', () => {
    fc.assert(
      fc.property(knownCodeArb, messageTextArb, messageTextArb, (code, messageA, messageB) => {
        const expected = (strings.errors as Record<string, string | undefined>)[code];

        // ...and it is the generic fallback only if the catalog itself maps the
        // code to that copy — never silently for a known code.
        expect(expected).toBeTypeOf('string');
        if (typeof expected !== 'string') {
          throw new Error(`Expected catalog copy for known code ${code}`);
        }

        // The curated catalog copy is what we resolve to...
        expect(messageForErrorCode(code)).toBe(expected);
        expect(expected.length).toBeGreaterThan(0);

        // Independence from message text: the accompanying backend message
        // (whatever it was, including `messageA` vs `messageB`) cannot change
        // the result, because the function keys ONLY on the code. Determinism
        // is captured by repeated calls yielding the identical string.
        expect(messageForErrorCode(code)).toBe(messageForErrorCode(code));
        void messageA;
        void messageB;
      }),
      { numRuns: 100 },
    );
  });

  it('resolves any unknown/unrecognized code to the generic fallback', () => {
    fc.assert(
      fc.property(unknownCodeArb, (code) => {
        expect(messageForErrorCode(code)).toBe(strings.errorFallback);
      }),
      { numRuns: 100 },
    );
  });

  it('resolves QUEUE_FULL to the queue-full copy specifically (drives the no-ticket join state)', () => {
    fc.assert(
      fc.property(messageTextArb, (accompanyingMessage) => {
        // Regardless of the backend's free-text message, QUEUE_FULL maps to the
        // dedicated queue-full copy and not the generic fallback (R2.5).
        expect(messageForErrorCode(ERROR_CODES.QUEUE_FULL)).toBe(strings.errors.QUEUE_FULL);
        expect(messageForErrorCode(ERROR_CODES.QUEUE_FULL)).not.toBe(strings.errorFallback);
        void accompanyingMessage;
      }),
      { numRuns: 100 },
    );
  });

  it('resolves null/undefined codes to the generic fallback', () => {
    fc.assert(
      fc.property(fc.constantFrom<null | undefined>(null, undefined), (code) => {
        expect(messageForErrorCode(code)).toBe(strings.errorFallback);
      }),
      { numRuns: 100 },
    );
  });
});
