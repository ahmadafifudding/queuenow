/*
 * Date & time formatting utilities — Requirements 7.10, 14.3.
 *
 * The org timezone comes from `Organization.timezone` (an IANA zone such as
 * `Asia/Kuala_Lumpur`). All DISPLAYED times must be formatted in the org's
 * timezone, NOT the browser's, so a staff member in one timezone and a Display
 * screen in another show identical wall-clock times for the same instant.
 *
 * This module centralizes that policy by wrapping `Intl.DateTimeFormat` with an
 * explicit `timeZone` option, which makes output independent of the host
 * timezone. It also provides the single place that SERIALIZES dates for the
 * backend as ISO-8601 strings — locale-formatted dates are never sent to the
 * API (Requirement 14.3).
 *
 * All functions are pure and deterministic given a fixed input + timezone, so
 * they are property-testable (design Property 13).
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
 * IANA timezone, independent of the browser timezone (Requirement 7.10).
 *
 * @param value    A `Date`, ISO/parseable string, or epoch milliseconds.
 * @param timeZone An IANA timezone identifier, e.g. `Asia/Kuala_Lumpur`.
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
 * independent of the browser timezone (Requirement 7.10). Produces a stable
 * `YYYY-MM-DD HH:mm` form so the same instant renders identically everywhere.
 *
 * @param value    A `Date`, ISO/parseable string, or epoch milliseconds.
 * @param timeZone An IANA timezone identifier, e.g. `Asia/Kuala_Lumpur`.
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
