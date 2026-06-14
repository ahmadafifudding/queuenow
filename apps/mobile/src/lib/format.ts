/*
 * Date & time formatting utilities (FMT) — Requirements 3.1 (and parity with
 * the web format contract, Requirements 7.10 / 14.3).
 *
 * This is the React Native / Expo counterpart of `apps/web/src/lib/format.ts`
 * and intentionally mirrors its function surface so both apps share one
 * formatting policy.
 *
 * The org timezone comes from `IOrganization.timezone` (an IANA zone such as
 * `Asia/Kuala_Lumpur`). All DISPLAYED times must be formatted in the org's
 * timezone, NOT the device's, so the same instant renders as identical
 * wall-clock times regardless of where the customer's phone happens to be.
 *
 * This module centralizes that policy by wrapping `Intl.DateTimeFormat` with an
 * explicit `timeZone` option, which makes output independent of the host/device
 * timezone. It is also the single place that SERIALIZES dates for the backend
 * as ISO-8601 strings — locale-formatted dates are never sent to the API
 * (Requirement 14.3).
 *
 * Wait estimates and durations are rendered in human terms ("~15 min") so the
 * customer sees an at-a-glance estimate rather than a raw number (Requirement
 * 3.1).
 *
 * All functions are pure and deterministic given a fixed input (+ timezone),
 * so they are unit- and property-testable.
 */

/** Accepted inputs across the formatting helpers: a `Date`, an ISO/parseable
 * string, or an epoch-milliseconds number. */
export type DateInput = Date | string | number;

/**
 * Error thrown when an input cannot be normalized to a valid `Date`.
 *
 * Callers receive a typed, named error (rather than a silent `Invalid Date` or
 * a `NaN`-bearing string) so invalid timestamps fail loudly and predictably.
 */
export class InvalidDateError extends Error {
  /** The original, un-normalizable input value. */
  public readonly input: DateInput;

  constructor(input: DateInput) {
    super(`Invalid date input: ${String(input)}`);
    this.name = 'InvalidDateError';
    this.input = input;
    // Restore prototype chain for instanceof checks when targeting ES5/ES6.
    Object.setPrototypeOf(this, InvalidDateError.prototype);
  }
}

/**
 * Error thrown when a wait/duration value is not a finite, non-negative number
 * of minutes. Mirrors {@link InvalidDateError} so duration formatting also fails
 * loudly rather than emitting `NaN`/`Infinity` into the UI.
 */
export class InvalidDurationError extends Error {
  /** The original, invalid minutes value. */
  public readonly minutes: number;

  constructor(minutes: number) {
    super(`Invalid duration (minutes): ${String(minutes)}`);
    this.name = 'InvalidDurationError';
    this.minutes = minutes;
    Object.setPrototypeOf(this, InvalidDurationError.prototype);
  }
}

/**
 * Normalize a {@link DateInput} into a valid `Date`.
 *
 * @throws {InvalidDateError} when the input does not represent a valid instant
 * (e.g. an unparseable string, `NaN`, or an `Invalid Date`).
 */
export function toDate(value: DateInput): Date {
  const date = value instanceof Date ? new Date(value.getTime()) : new Date(value);

  if (Number.isNaN(date.getTime())) {
    throw new InvalidDateError(value);
  }

  return date;
}

/**
 * Format an instant as an absolute time-of-day (`HH:mm`, 24-hour) in the given
 * IANA timezone, independent of the device timezone (Requirement 3.1 / web
 * parity 7.10).
 *
 * @param value    A `Date`, ISO/parseable string, or epoch milliseconds.
 * @param timeZone An IANA timezone identifier, e.g. `Asia/Kuala_Lumpur`
 *                 (`IOrganization.timezone`).
 * @throws {InvalidDateError} when `value` is not a valid instant.
 * @throws {RangeError} when `timeZone` is not a recognized IANA zone.
 */
export function formatTimeInZone(value: DateInput, timeZone: string): string {
  const date = toDate(value);

  return new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(date);
}

/**
 * Format an instant as an absolute date + time in the given IANA timezone,
 * independent of the device timezone. Produces a stable `YYYY-MM-DD HH:mm` form
 * so the same instant renders identically everywhere.
 *
 * @param value    A `Date`, ISO/parseable string, or epoch milliseconds.
 * @param timeZone An IANA timezone identifier, e.g. `Asia/Kuala_Lumpur`
 *                 (`IOrganization.timezone`).
 * @throws {InvalidDateError} when `value` is not a valid instant.
 * @throws {RangeError} when `timeZone` is not a recognized IANA zone.
 */
export function formatDateTimeInZone(value: DateInput, timeZone: string): string {
  const date = toDate(value);

  // `en-CA` yields ISO-like `YYYY-MM-DD` date parts; combined with a 24-hour
  // time this gives a locale-stable, zone-correct absolute timestamp.
  const datePart = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);

  const timePart = formatTimeInZone(date, timeZone);

  return `${datePart} ${timePart}`;
}

/**
 * Serialize a date for the backend as an ISO-8601 string (UTC, `Z`-suffixed).
 *
 * This is the ONLY way dates should be sent to the API — never locale-formatted
 * strings (Requirement 14.3). The output is timezone-independent because it is
 * expressed in UTC.
 *
 * @param value A `Date`, ISO/parseable string, or epoch milliseconds.
 * @throws {InvalidDateError} when `value` is not a valid instant.
 */
export function toIsoString(value: DateInput): string {
  return toDate(value).toISOString();
}

/**
 * Render an estimated wait time, in whole minutes, in human terms (Requirement
 * 3.1). The backend supplies `estimatedWaitMinutes` and the value is shown
 * verbatim (no client-side arithmetic on the queue position) — this helper only
 * formats the presentation:
 *
 *   - `0`            → `"now"`            (no remaining wait)
 *   - `1`            → `"~1 min"`
 *   - `15`           → `"~15 min"`
 *   - `60`           → `"~1 hr"`
 *   - `90`           → `"~1 hr 30 min"`
 *   - `135`          → `"~2 hr 15 min"`
 *
 * The leading `~` signals the value is an estimate. Inputs are rounded to the
 * nearest minute so callers may pass fractional minutes safely.
 *
 * @param minutes A finite, non-negative number of minutes.
 * @throws {InvalidDurationError} when `minutes` is not finite or is negative.
 */
export function formatWaitEstimate(minutes: number): string {
  if (!Number.isFinite(minutes) || minutes < 0) {
    throw new InvalidDurationError(minutes);
  }

  const total = Math.round(minutes);

  if (total === 0) {
    return 'now';
  }

  const hours = Math.floor(total / 60);
  const mins = total % 60;

  const parts: string[] = [];
  if (hours > 0) {
    parts.push(`${hours} hr`);
  }
  if (mins > 0) {
    parts.push(`${mins} min`);
  }

  return `~${parts.join(' ')}`;
}
