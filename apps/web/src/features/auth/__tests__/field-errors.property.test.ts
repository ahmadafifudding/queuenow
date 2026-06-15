// Feature: web-app, Property 6: Backend field errors map onto matching form fields
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { toFieldErrors } from '../lib/field-errors';

/**
 * Property 6 — Validates: Requirements 4.10
 *
 * When the API returns `error.details` (a `field -> message` map), the form
 * helper `toFieldErrors` must map each entry whose key is a KNOWN form field and
 * whose value is a usable string message into the returned `fields` record —
 * exactly once, with the corresponding message, and never onto a different
 * field. Detail keys that are unknown or carry no usable string message must NOT
 * appear in `fields` and must be reported as `unmapped`. This `fields` record is
 * what the form's `onSubmitAsync` validator returns to TanStack Form so the
 * inline errors land on the matching inputs.
 */

/** Fixed pool of valid field paths for the form under test. */
const FIELD_POOL = ['email', 'password', 'fullName', 'organizationName'] as const;

/**
 * Coerce a generated detail value into the single string the helper would
 * derive, mirroring the helper's `toMessage`: a plain string stays as-is, a
 * string[] joins on a space when non-empty, otherwise there is no usable
 * message (null). Kept independent of the implementation to act as an oracle.
 */
function expectedMessage(value: unknown): string | null {
  if (typeof value === 'string') {
    return value;
  }
  if (Array.isArray(value)) {
    const parts = value.filter((p): p is string => typeof p === 'string');
    return parts.length > 0 ? parts.join(' ') : null;
  }
  return null;
}

/** A known field name drawn from the fixed pool. */
const knownKey: fc.Arbitrary<string> = fc.constantFrom(...FIELD_POOL);

/** An unknown key: any string that is NOT one of the known fields. */
const unknownKey: fc.Arbitrary<string> = fc
  .string()
  .filter((s) => !(FIELD_POOL as readonly string[]).includes(s));

/**
 * A detail value: usually a usable string or string[] (the mappable cases),
 * sometimes an unusable value (empty array / non-string content / number /
 * null) so the "no usable message" branch is exercised too.
 */
const detailValue: fc.Arbitrary<unknown> = fc.oneof(
  fc.string(),
  fc.array(fc.string(), { minLength: 1, maxLength: 3 }),
  fc.constant([]),
  fc.array(fc.integer(), { minLength: 1, maxLength: 3 }),
  fc.integer(),
  fc.constant(null),
);

/**
 * A `details` record mixing known and unknown keys. We build it from an array
 * of [key, value] entries (dedup happens naturally via object construction)
 * so each emitted record has a well-defined, order-independent key set.
 */
const detailsArb: fc.Arbitrary<Record<string, unknown>> = fc
  .array(fc.tuple(fc.oneof(knownKey, unknownKey), detailValue), { maxLength: 8 })
  .map((entries) => {
    const record: Record<string, unknown> = {};
    for (const [k, v] of entries) {
      record[k] = v;
    }
    return record;
  });

describe('Property 6: backend field errors map onto matching form fields', () => {
  it('maps usable messages for known fields exactly once onto the matching field, leaving others unmapped', () => {
    fc.assert(
      fc.property(detailsArb, (details) => {
        const { fields, mapped, unmapped } = toFieldErrors(details, FIELD_POOL);

        const knownSet = new Set<string>(FIELD_POOL);

        // Partition the input by the oracle to know what SHOULD have mapped.
        const expectedMapped = new Map<string, string>();
        const expectedUnmapped = new Set<string>();
        for (const [key, raw] of Object.entries(details)) {
          const msg = expectedMessage(raw);
          if (msg !== null && knownSet.has(key)) {
            expectedMapped.set(key, msg);
          } else {
            expectedUnmapped.add(key);
          }
        }

        // Returned partition matches the oracle (order-independent).
        expect(new Set(mapped)).toEqual(new Set(expectedMapped.keys()));
        expect(new Set(unmapped)).toEqual(expectedUnmapped);
        // Every input key is accounted for exactly once across the partition.
        expect(mapped.length + unmapped.length).toBe(Object.keys(details).length);

        // The `fields` record has exactly the expected-mapped keys, each with
        // its OWN message (no cross-field leakage, no extras).
        expect(new Set(Object.keys(fields))).toEqual(new Set(expectedMapped.keys()));
        for (const [field, message] of expectedMapped) {
          expect(fields[field]).toBe(message);
        }

        // Unknown/unusable keys never appear in the fields record. Use an
        // own-property check so generated keys like "constructor"/"toString"
        // (present on Object.prototype) are not mistaken for mapped fields.
        for (const key of expectedUnmapped) {
          expect(Object.prototype.hasOwnProperty.call(fields, key)).toBe(false);
        }
      }),
      { numRuns: 200 },
    );
  });
});
