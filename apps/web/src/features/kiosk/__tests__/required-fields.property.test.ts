// Feature: web-app, Property 17: Kiosk required-field set matches QueueSettings
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { buildKioskJoinSchema, kioskRequiredFields } from '../lib/required-fields';
import type { KioskQueueSettings } from '../types';

/**
 * Property 17 — Validates: Requirements 12.3
 *
 * The Kiosk only collects the customer name/phone when the org's
 * `QueueSettings` require them: name is required iff `requireName`, phone is
 * required iff `requirePhone`. The pure derivation under test is
 * `kioskRequiredFields(settings)` (and the `buildKioskJoinSchema(settings)`
 * Zod schema layered on the shared `joinQueueSchema`). The oracle is the
 * settings booleans themselves.
 *
 * We assert this two ways:
 *   1. The derived required-field set equals exactly the settings booleans, for
 *      every `requireName` × `requirePhone` combination (plus the ignored
 *      `maxRecall` flag, to prove it never influences gating).
 *   2. The derived schema accepts a submission iff every required field is
 *      non-blank, and when it rejects, the failing field paths equal exactly the
 *      set of required-and-blank fields — never more, never fewer.
 */

/** A single collectable field value tagged with whether it is "blank" (absent or whitespace-only). */
interface TaggedField {
  /** The value placed on the join payload (may be omitted via `undefined`). */
  readonly value: string | undefined;
  /** True when the value is absent or only whitespace (fails a required check). */
  readonly blank: boolean;
}

/**
 * Arbitrary field value spanning the three shapes the form can submit: omitted,
 * blank/whitespace-only, and a genuine non-blank string. Appending a literal
 * `x` guarantees the "non-blank" branch survives trimming.
 */
const taggedField: fc.Arbitrary<TaggedField> = fc.oneof(
  fc.constant<TaggedField>({ value: undefined, blank: true }),
  fc.constantFrom('', '   ', '\t', '\n  ').map((value) => ({ value, blank: true })),
  fc.string({ maxLength: 16 }).map((s) => ({ value: `${s}x`, blank: false })),
);

/** Arbitrary kiosk queue settings: both gates plus the ignored `maxRecall`. */
const settingsArb: fc.Arbitrary<KioskQueueSettings> = fc.record({
  requireName: fc.boolean(),
  requirePhone: fc.boolean(),
  maxRecall: fc.integer({ min: 0, max: 10 }),
});

/** A valid `serviceId` so the only variability is the required-field gating. */
const serviceIdArb: fc.Arbitrary<string> = fc.uuid();

describe('Property 17: kiosk required-field set matches QueueSettings', () => {
  it('derives the required-field set exactly from the settings booleans', () => {
    fc.assert(
      fc.property(settingsArb, (settings) => {
        const required = kioskRequiredFields(settings);
        // name is required iff requireName; phone is required iff requirePhone.
        expect(required.name).toBe(settings.requireName);
        expect(required.phone).toBe(settings.requirePhone);
      }),
      { numRuns: 200 },
    );
  });

  it('accepts a submission iff every required field is non-blank', () => {
    fc.assert(
      fc.property(
        settingsArb,
        serviceIdArb,
        taggedField,
        taggedField,
        (settings, serviceId, name, phone) => {
          const schema = buildKioskJoinSchema(settings);
          const result = schema.safeParse({
            serviceId,
            customerName: name.value,
            customerPhone: phone.value,
          });

          // Oracle: valid exactly when no *required* field is blank.
          const nameOk = !settings.requireName || !name.blank;
          const phoneOk = !settings.requirePhone || !phone.blank;
          expect(result.success).toBe(nameOk && phoneOk);
        },
      ),
      { numRuns: 200 },
    );
  });

  it('reports exactly the required-and-blank fields when it rejects', () => {
    fc.assert(
      fc.property(
        settingsArb,
        serviceIdArb,
        taggedField,
        taggedField,
        (settings, serviceId, name, phone) => {
          const schema = buildKioskJoinSchema(settings);
          const result = schema.safeParse({
            serviceId,
            customerName: name.value,
            customerPhone: phone.value,
          });

          // The oracle set of fields that should fail: required AND blank.
          const expectedFailures = new Set<string>();
          if (settings.requireName && name.blank) expectedFailures.add('customerName');
          if (settings.requirePhone && phone.blank) expectedFailures.add('customerPhone');

          if (expectedFailures.size === 0) {
            expect(result.success).toBe(true);
            return;
          }

          expect(result.success).toBe(false);
          if (result.success) return;
          const actualFailures = new Set(result.error.issues.map((issue) => String(issue.path[0])));
          expect(actualFailures).toEqual(expectedFailures);
        },
      ),
      { numRuns: 200 },
    );
  });
});
