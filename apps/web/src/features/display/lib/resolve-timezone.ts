/*
 * resolveTimeZone — pick the IANA timezone the Display board formats times in
 * (R7.10, Org_Timezone).
 *
 * Times on the board MUST render in the organization's timezone, independent of
 * the browser/host timezone (a TV in one region showing an org configured in
 * another must show the org's wall-clock time). The canonical source is
 * `Organization.timezone`.
 *
 * ASSUMPTION (documented): none of the PUBLIC endpoints the Display is allowed
 * to read (`GET /organizations/:orgId/queue/status`, `GET /organizations/:orgId/
 * display`) expose `Organization.timezone` — the public payloads carry only the
 * org id/name (+ branding) and the queue snapshot. Rather than make the public
 * board depend on an authenticated org read, the unattended screen is
 * configured with the org timezone as a `?tz=` search param on the URL, e.g.
 * `/display/abc123?tz=Asia/Kuala_Lumpur`. This keeps the displayed times
 * deterministic and host-independent.
 *
 * When the param is absent or not a recognized IANA zone, we fall back to a
 * documented default ({@link DEFAULT_DISPLAY_TIMEZONE}) — the project's primary
 * timezone — so the board always renders valid, stable times rather than
 * throwing or silently using the browser zone. If/when a public endpoint starts
 * exposing the org timezone, prefer that over the param here.
 */

/**
 * Default timezone used when no valid `?tz=` param is supplied. Matches the
 * project's primary timezone (see the backend `timezone` DTO example).
 */
export const DEFAULT_DISPLAY_TIMEZONE = 'Asia/Kuala_Lumpur';

/**
 * Whether a string is a timezone identifier the runtime's `Intl` recognizes.
 *
 * `Intl.DateTimeFormat` throws a `RangeError` for an unknown `timeZone`, so a
 * successful construction is a reliable validity check across environments.
 *
 * @param timeZone - candidate IANA timezone (e.g. `Asia/Kuala_Lumpur`).
 */
export function isValidTimeZone(timeZone: string): boolean {
  if (!timeZone) {
    return false;
  }
  try {
    // Constructing with the zone is enough to validate it; the result is unused.
    new Intl.DateTimeFormat('en-US', { timeZone });
    return true;
  } catch {
    return false;
  }
}

/**
 * Resolve the timezone the board should format times in.
 *
 * @param tzParam - optional IANA timezone from the route `?tz=` search param.
 * @returns `tzParam` when it is a recognized IANA zone, otherwise
 * {@link DEFAULT_DISPLAY_TIMEZONE}.
 */
export function resolveTimeZone(tzParam?: string): string {
  if (tzParam && isValidTimeZone(tzParam)) {
    return tzParam;
  }
  return DEFAULT_DISPLAY_TIMEZONE;
}
