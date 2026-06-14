/*
 * Daily-queue-volume window helper — Requirement 2.4.
 *
 * `Daily_Queue_Volume` is measured over the window that BEGINS at the
 * Organization's `Reset_Time` in the Organization's timezone and ENDS at the
 * next occurrence of that Reset_Time (a half-open interval `[start, end)`).
 *
 * This module is a PURE, deterministic utility: given a timezone, a reset time,
 * and an instant `now`, it returns the window that contains `now`. It performs
 * its own wall-clock <-> UTC conversion via `Intl.DateTimeFormat` so it is
 * correct across DST transitions (where a calendar day is 23h or 25h long) and
 * independent of the host machine timezone. Because it is pure, it is unit- and
 * property-testable (design Property 3).
 */

import { QUEUE_DEFAULTS } from '@queuenow/shared-constants';

/**
 * The resolved daily-volume window in the organization's timezone.
 *
 * - `start` — the inclusive UTC instant at which the window begins (the
 *   `Reset_Time` wall-clock on `windowDate` in the org timezone).
 * - `end` — the exclusive UTC instant at which the window ends (the next
 *   occurrence of `Reset_Time`, i.e. the following calendar day).
 * - `windowDate` — a UTC-midnight `Date` whose calendar `YYYY-MM-DD` is the org-
 *   timezone calendar date the window starts on. This is the stable key used to
 *   aggregate per-day counters.
 */
export interface DailyWindow {
  start: Date;
  end: Date;
  windowDate: Date;
}

/** Parsed `HH:MM` reset time as a count of hours and minutes. */
interface ResetTime {
  hour: number;
  minute: number;
}

/** Calendar date + clock components describing a wall-clock reading in a zone. */
interface ZonedParts {
  year: number;
  month: number; // 1-12
  day: number; // 1-31
  hour: number; // 0-23
  minute: number; // 0-59
  second: number; // 0-59
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;
// Strict zero-padded `HH:MM` (24-hour) — the format `QueueSettings.resetTime`
// is stored in (default `'00:00'`). Anything else is treated as malformed.
const RESET_TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;

/**
 * Parse a `HH:MM` (24-hour) reset time, falling back to the platform default
 * (`QUEUE_DEFAULTS.RESET_TIME`) when the input is missing or malformed.
 */
function parseResetTime(resetTime: string): ResetTime {
  const match = RESET_TIME_PATTERN.exec(resetTime?.trim() ?? '');
  if (!match) {
    // Default is itself a valid `HH:MM` string, so this match always succeeds.
    const fallback = RESET_TIME_PATTERN.exec(QUEUE_DEFAULTS.RESET_TIME);
    return {
      hour: Number(fallback?.[1] ?? 0),
      minute: Number(fallback?.[2] ?? 0),
    };
  }
  return { hour: Number(match[1]), minute: Number(match[2]) };
}

/**
 * Read the wall-clock components of `instant` as observed in `timeZone`.
 * Uses `Intl.DateTimeFormat` with an explicit `timeZone`, so the result is
 * independent of the host timezone and correct across DST.
 */
function getZonedParts(timeZone: string, instant: Date): ZonedParts {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });

  const parts: Record<string, string> = {};
  for (const part of formatter.formatToParts(instant)) {
    if (part.type !== 'literal') {
      parts[part.type] = part.value;
    }
  }

  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    // `hourCycle: 'h23'` can emit '24' for midnight in some engines; normalize.
    hour: Number(parts.hour) % 24,
    minute: Number(parts.minute),
    second: Number(parts.second),
  };
}

/**
 * The signed offset (in ms) between `timeZone`'s wall clock and UTC at `instant`,
 * such that `wallClockAsUtc - utcInstant = offset`.
 */
function zoneOffsetMs(timeZone: string, instant: Date): number {
  const p = getZonedParts(timeZone, instant);
  const wallClockAsUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  // Drop sub-second precision from the instant for a clean offset.
  const utc = Math.floor(instant.getTime() / 1000) * 1000;
  return wallClockAsUtc - utc;
}

/**
 * Convert a wall-clock time (`year`/`month`/`day` `hour:minute`) in `timeZone`
 * into the corresponding UTC `Date`.
 *
 * Works across DST by computing the zone offset at an initial guess and
 * refining once — this resolves both "fall back" (ambiguous) and "spring
 * forward" (gap) transitions to a stable instant.
 */
function zonedWallClockToUtc(
  timeZone: string,
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
): Date {
  // First guess: pretend the wall clock is UTC, then subtract the zone offset.
  const guessUtc = Date.UTC(year, month - 1, day, hour, minute);
  const firstOffset = zoneOffsetMs(timeZone, new Date(guessUtc));
  let resultUtc = guessUtc - firstOffset;

  // Refine: the offset at the candidate instant may differ across a DST edge.
  const secondOffset = zoneOffsetMs(timeZone, new Date(resultUtc));
  if (secondOffset !== firstOffset) {
    resultUtc = guessUtc - secondOffset;
  }

  return new Date(resultUtc);
}

/** Shift a calendar date (Y/M/D) by `deltaDays`, returning the new Y/M/D. */
function addCalendarDays(
  year: number,
  month: number,
  day: number,
  deltaDays: number,
): { year: number; month: number; day: number } {
  // Calendar arithmetic is timezone-independent; do it in UTC then read back.
  const shifted = new Date(Date.UTC(year, month - 1, day) + deltaDays * MS_PER_DAY);
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
  };
}

/**
 * Resolve the daily-volume window `[start, end)` that contains `now`, in the
 * organization's timezone, beginning at `resetTime` (Requirement 2.4).
 *
 * The window always satisfies `start <= now < end`, spans exactly one calendar
 * day in `timezone` (DST-aware: 23h/25h on transition days), and `start`'s
 * wall-clock time in `timezone` equals `resetTime`.
 *
 * @param timezone  An IANA timezone identifier, e.g. `Asia/Kuala_Lumpur`.
 * @param resetTime The daily reset time as `HH:MM` (24-hour). Defaults to
 *                  `QUEUE_DEFAULTS.RESET_TIME` when missing or malformed.
 * @param now       The instant for which to resolve the containing window.
 * @throws {RangeError} when `timezone` is not a recognized IANA zone.
 */
export function resolveDailyWindow(timezone: string, resetTime: string, now: Date): DailyWindow {
  const { hour, minute } = parseResetTime(resetTime);

  // The org-timezone calendar date `now` falls on.
  const today = getZonedParts(timezone, now);

  // Reset instant on today's calendar date.
  const todayReset = zonedWallClockToUtc(
    timezone,
    today.year,
    today.month,
    today.day,
    hour,
    minute,
  );

  // If `now` is before today's reset, the active window started the prior day.
  const startDate =
    now.getTime() >= todayReset.getTime()
      ? { year: today.year, month: today.month, day: today.day }
      : addCalendarDays(today.year, today.month, today.day, -1);

  const start = zonedWallClockToUtc(
    timezone,
    startDate.year,
    startDate.month,
    startDate.day,
    hour,
    minute,
  );

  const endDate = addCalendarDays(startDate.year, startDate.month, startDate.day, 1);
  const end = zonedWallClockToUtc(timezone, endDate.year, endDate.month, endDate.day, hour, minute);

  // Stable per-day key: UTC midnight of the start calendar date.
  const windowDate = new Date(Date.UTC(startDate.year, startDate.month - 1, startDate.day));

  return { start, end, windowDate };
}
