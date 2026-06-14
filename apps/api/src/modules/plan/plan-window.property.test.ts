// Feature: plan-limit-enforcement, Property 3: Daily-volume window is the org-timezone reset-time day

import fc from 'fast-check';

import { resolveDailyWindow } from './plan-window.util';

/**
 * Property 3 — Daily-volume window is the org-timezone reset-time day.
 * Validates: Requirements 2.4
 *
 * For any timezone, any `resetTime` (`HH:MM`), and any instant `now`,
 * `resolveDailyWindow` returns a half-open interval `[start, end)` such that:
 *   (A) `start <= now < end` (the window contains the instant);
 *   (B) the interval spans exactly ONE calendar day in that timezone — i.e.
 *       `end`'s org-timezone calendar date is exactly one day after `start`'s,
 *       which remains true across DST transitions where the elapsed wall time is
 *       23h or 25h rather than 24h; and
 *   (C) `start`'s (and `end`'s) wall-clock time in the org timezone equals
 *       `resetTime`.
 *
 * Strategy:
 * - The oracle is an INDEPENDENT `Intl.DateTimeFormat` pinned to the org
 *   timezone (a different mechanism than the offset-arithmetic the util uses to
 *   CONSTRUCT the window), so matching it genuinely cross-checks the result.
 * - Non-DST zones are tested over the FULL `HH:MM` range, since every wall clock
 *   exists and is unambiguous there.
 * - DST zones are tested with `resetTime` hours >= 4 to avoid the spring-forward
 *   gap (a wall clock that does not exist, ~01:00–03:59 local in these zones)
 *   while still exercising DST: a full-day window straddling the 02:00 shift is
 *   23h/25h long yet must still span exactly one calendar day and pin to
 *   `resetTime`. A naive `start + 24h` implementation fails (B)/(C) here.
 */

const RUNS = 200;

const NON_DST_ZONES = [
  'UTC', // +00:00
  'Asia/Kuala_Lumpur', // +08:00
  'Asia/Tokyo', // +09:00
  'Pacific/Kiritimati', // +14:00 (extreme)
  'Asia/Kathmandu', // +05:45 (fractional offset)
] as const;

const DST_ZONES = [
  'America/New_York', // -05:00 / -04:00
  'Europe/London', // +00:00 / +01:00
  'Australia/Sydney', // +10:00 / +11:00 (southern hemisphere)
] as const;

// Wide instant range so DST transitions across many years are exercised.
const MIN_DATE = new Date(Date.UTC(2018, 0, 1));
const MAX_DATE = new Date(Date.UTC(2035, 11, 31, 23, 59, 59, 999));

const instant = (): fc.Arbitrary<Date> =>
  fc.date({ min: MIN_DATE, max: MAX_DATE, noInvalidDate: true });

const pad = (n: number): string => String(n).padStart(2, '0');

/** Generate an `HH:MM` reset time with hour in `[minHour, 23]`. */
const resetTime = (minHour: number): fc.Arbitrary<string> =>
  fc
    .tuple(fc.integer({ min: minHour, max: 23 }), fc.integer({ min: 0, max: 59 }))
    .map(([h, m]) => `${pad(h)}:${pad(m)}`);

/** Independent oracle: the org-timezone wall clock of `instant`. */
function zonedParts(
  timeZone: string,
  date: Date,
): {
  ymd: string;
  hhmm: string;
} {
  const parts: Record<string, string> = {};
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
  for (const part of fmt.formatToParts(date)) {
    if (part.type !== 'literal') parts[part.type] = part.value;
  }
  const hour = pad(Number(parts.hour) % 24);
  return {
    ymd: `${parts.year}-${parts.month}-${parts.day}`,
    hhmm: `${hour}:${parts.minute}`,
  };
}

/** The calendar date string one day after `ymd` (timezone-independent). */
function nextCalendarDay(ymd: string): string {
  const [y, m, d] = ymd.split('-').map(Number) as [number, number, number];
  const next = new Date(Date.UTC(y, m - 1, d) + 24 * 60 * 60 * 1000);
  return `${next.getUTCFullYear()}-${pad(next.getUTCMonth() + 1)}-${pad(next.getUTCDate())}`;
}

function assertWindowInvariants(timezone: string, reset: string, now: Date): void {
  const { start, end, windowDate } = resolveDailyWindow(timezone, reset, now);

  // (A) half-open interval contains `now`.
  expect(start.getTime()).toBeLessThanOrEqual(now.getTime());
  expect(now.getTime()).toBeLessThan(end.getTime());

  const startParts = zonedParts(timezone, start);
  const endParts = zonedParts(timezone, end);

  // (C) start (and end) wall-clock equals the requested reset time.
  expect(startParts.hhmm).toBe(reset);
  expect(endParts.hhmm).toBe(reset);

  // (B) end is exactly one calendar day after start in the org timezone.
  expect(endParts.ymd).toBe(nextCalendarDay(startParts.ymd));

  // windowDate's UTC calendar date matches the org-timezone start date.
  const windowYmd = `${windowDate.getUTCFullYear()}-${pad(windowDate.getUTCMonth() + 1)}-${pad(
    windowDate.getUTCDate(),
  )}`;
  expect(windowYmd).toBe(startParts.ymd);
  expect(windowDate.getUTCHours()).toBe(0);
  expect(windowDate.getUTCMinutes()).toBe(0);
}

describe('Property 3: Daily-volume window is the org-timezone reset-time day', () => {
  it('holds for non-DST zones across the full HH:MM reset range', () => {
    fc.assert(
      fc.property(fc.constantFrom(...NON_DST_ZONES), resetTime(0), instant(), (tz, reset, now) => {
        assertWindowInvariants(tz, reset, now);
      }),
      { numRuns: RUNS },
    );
  });

  it('holds for DST zones (reset outside the spring-forward gap), spanning DST transitions', () => {
    fc.assert(
      fc.property(fc.constantFrom(...DST_ZONES), resetTime(4), instant(), (tz, reset, now) => {
        assertWindowInvariants(tz, reset, now);
      }),
      { numRuns: RUNS },
    );
  });

  it('defaults a malformed reset time to QUEUE_DEFAULTS.RESET_TIME (00:00)', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...NON_DST_ZONES),
        fc.constantFrom('', 'nonsense', '25:00', '12:60', '7', '07:5'),
        instant(),
        (tz, badReset, now) => {
          const { start } = resolveDailyWindow(tz, badReset, now);
          expect(zonedParts(tz, start).hhmm).toBe('00:00');
        },
      ),
      { numRuns: RUNS },
    );
  });

  it('exercises DST transition days explicitly (window is 23h/25h, still one calendar day)', () => {
    // Instants within US DST transition days (local 02:00 shift on these dates).
    const transitionInstants = [
      new Date('2024-03-10T12:00:00Z'), // US spring forward
      new Date('2024-11-03T12:00:00Z'), // US fall back
      new Date('2025-03-30T12:00:00Z'), // EU spring forward
      new Date('2025-10-26T12:00:00Z'), // EU fall back
      new Date('2024-10-06T12:00:00Z'), // AU spring forward
      new Date('2025-04-06T12:00:00Z'), // AU fall back
    ];

    fc.assert(
      fc.property(
        fc.constantFrom(...DST_ZONES),
        resetTime(4),
        fc.constantFrom(...transitionInstants),
        (tz, reset, now) => {
          assertWindowInvariants(tz, reset, now);
        },
      ),
      { numRuns: RUNS },
    );
  });
});
