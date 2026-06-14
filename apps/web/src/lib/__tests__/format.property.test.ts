// Feature: web-app, Property 13: Times format in the org timezone and serialize to the backend as ISO

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { formatDateTimeInZone, formatTimeInZone, toIsoString } from '@/lib/format';

/**
 * Property 13 — Times format in the org timezone and serialize to the backend as ISO.
 * Validates: Requirements 7.10, 14.3
 *
 * Strategy:
 * - Generator: arbitrary `Date` instants within a sane range (1970–2100) crossed
 *   with a set of representative IANA timezones spanning negative, zero, positive,
 *   and extreme positive UTC offsets.
 * - Reference oracle: an INDEPENDENT `Intl.DateTimeFormat` built with the exact
 *   `timeZone` + options that `format.ts` documents. Because the oracle pins an
 *   explicit `timeZone`, its output is inherently independent of the host/browser
 *   timezone — matching it proves the function is too.
 * - ISO oracle: `Date.prototype.toISOString` semantics + round-trip equality.
 */

const RUNS = 200;

// Representative IANA zones: negative offset, UTC, classic DST zones, +9 (no DST),
// and the most extreme positive offset (+14) to stress day-boundary wrapping.
const TIMEZONES = [
  'Asia/Kuala_Lumpur', // UTC+8, no DST
  'UTC', // UTC+0
  'America/New_York', // UTC-5/-4 (DST)
  'Europe/London', // UTC+0/+1 (DST)
  'Asia/Tokyo', // UTC+9, no DST
  'Pacific/Kiritimati', // UTC+14, no DST (extreme)
] as const;

// Sane instant range: avoids pre-epoch/edge-of-time quirks while still spanning
// many decades, DST transitions, and leap years.
const MIN_DATE = new Date(Date.UTC(1970, 0, 1));
const MAX_DATE = new Date(Date.UTC(2100, 11, 31, 23, 59, 59, 999));

const instant = (): fc.Arbitrary<Date> =>
  fc.date({ min: MIN_DATE, max: MAX_DATE, noInvalidDate: true });

const timezone = (): fc.Arbitrary<(typeof TIMEZONES)[number]> => fc.constantFrom(...TIMEZONES);

/** Independent reference for {@link formatTimeInZone}, mirroring its documented options. */
function referenceTime(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(date);
}

/** Independent reference for {@link formatDateTimeInZone}, mirroring its documented options. */
function referenceDateTime(date: Date, timeZone: string): string {
  const datePart = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);

  return `${datePart} ${referenceTime(date, timeZone)}`;
}

// Strict ISO-8601 UTC (Z-suffixed) shape produced by Date.prototype.toISOString.
const ISO_8601_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

describe('Property 13: org-timezone formatting and ISO serialization', () => {
  it('Property A: formatTimeInZone matches an independent timezone-pinned oracle', () => {
    fc.assert(
      fc.property(instant(), timezone(), (date, tz) => {
        expect(formatTimeInZone(date, tz)).toBe(referenceTime(date, tz));
      }),
      { numRuns: RUNS },
    );
  });

  it('Property A: formatDateTimeInZone matches an independent timezone-pinned oracle', () => {
    fc.assert(
      fc.property(instant(), timezone(), (date, tz) => {
        expect(formatDateTimeInZone(date, tz)).toBe(referenceDateTime(date, tz));
      }),
      { numRuns: RUNS },
    );
  });

  it("Property A: output is independent of host TZ — UTC formatting equals the instant's UTC wall-clock", () => {
    fc.assert(
      fc.property(instant(), (date) => {
        const expected = `${String(date.getUTCHours()).padStart(2, '0')}:${String(
          date.getUTCMinutes(),
        ).padStart(2, '0')}`;
        expect(formatTimeInZone(date, 'UTC')).toBe(expected);
      }),
      { numRuns: RUNS },
    );
  });

  it('Property A: two org timezones differ by their fixed offset (UTC vs Asia/Tokyo = +9h)', () => {
    fc.assert(
      fc.property(instant(), (date) => {
        const toMinutes = (hhmm: string): number => {
          const [hours, minutes] = hhmm.split(':');
          return Number(hours) * 60 + Number(minutes);
        };

        const utc = toMinutes(formatTimeInZone(date, 'UTC'));
        const tokyo = toMinutes(formatTimeInZone(date, 'Asia/Tokyo'));

        // Tokyo is a fixed UTC+9 (no DST); wrap across the day boundary.
        const diff = (tokyo - utc + 24 * 60) % (24 * 60);
        expect(diff).toBe(9 * 60);
      }),
      { numRuns: RUNS },
    );
  });

  it('Property B: toIsoString produces a valid ISO-8601 string that round-trips to the same instant', () => {
    fc.assert(
      fc.property(instant(), (date) => {
        const iso = toIsoString(date);

        // Valid ISO-8601 UTC shape.
        expect(iso).toMatch(ISO_8601_UTC);
        // Matches Date.prototype.toISOString semantics.
        expect(iso).toBe(date.toISOString());
        // Round-trips back to the exact original instant.
        expect(new Date(iso).getTime()).toBe(date.getTime());
      }),
      { numRuns: RUNS },
    );
  });

  it('Property B: toIsoString accepts ISO strings and epoch millis, preserving the instant', () => {
    fc.assert(
      fc.property(instant(), (date) => {
        const fromIso = toIsoString(date.toISOString());
        const fromMillis = toIsoString(date.getTime());

        expect(fromIso).toBe(date.toISOString());
        expect(fromMillis).toBe(date.toISOString());
        expect(new Date(fromMillis).getTime()).toBe(date.getTime());
      }),
      { numRuns: RUNS },
    );
  });
});
