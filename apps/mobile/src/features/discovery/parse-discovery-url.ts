/**
 * PURE QR / deep-link parsing for discovery (R1.1, R1.2).
 *
 * The backend `qr-code.service` encodes a join deep link of the shape
 * `{base}/join/{slug}` or `{base}/join/{slug}?service={serviceId}` (design
 * "Discovery note"). {@link parseDiscoveryUrl} is the inverse of
 * {@link buildJoinDeepLink}: building a URL from a `slug` (+ optional
 * `serviceId`) and parsing it back yields the same `slug`/`serviceId` and
 * `source: 'qr'` (Property 1, task 7.2).
 *
 * Everything in this module is PURE and side-effect free: no I/O, no `Date`, no
 * randomness. Parsing is done by hand (not via the `URL` constructor) so it is
 * fully deterministic across the Hermes runtime and the test environment, and
 * so a malformed scan returns `null` rather than throwing.
 */
import type { DiscoveryTarget } from './types';

/** The path marker that precedes the org slug in a join deep link. */
const JOIN_MARKER = '/join/';
/** The query parameter that carries a service id in a service-specific QR. */
const SERVICE_PARAM = 'service';

/**
 * Parse a scanned QR deep link into a {@link DiscoveryTarget}.
 *
 * Accepts any string; returns `null` for anything that is not a recognizable
 * join deep link (no `/join/` segment, empty slug, non-string input). On
 * success the returned target carries the decoded `slug`, an optional decoded
 * `serviceId` (only when the `service` query param is present and non-empty),
 * and `source: 'qr'`.
 *
 * @param scannedUrl The raw string decoded from the scanned QR code.
 * @returns The parsed target, or `null` when the URL is not a join deep link.
 */
export function parseDiscoveryUrl(scannedUrl: string): DiscoveryTarget | null {
  if (typeof scannedUrl !== 'string') {
    return null;
  }

  const trimmed = scannedUrl.trim();
  if (trimmed === '') {
    return null;
  }

  // Drop any fragment, then split the path from the query string.
  const beforeFragment = trimmed.split('#')[0] ?? '';
  const questionIndex = beforeFragment.indexOf('?');
  const pathPart = questionIndex === -1 ? beforeFragment : beforeFragment.slice(0, questionIndex);
  const queryPart = questionIndex === -1 ? '' : beforeFragment.slice(questionIndex + 1);

  // Locate the `/join/` marker and take the first path segment after it.
  const markerIndex = pathPart.indexOf(JOIN_MARKER);
  if (markerIndex === -1) {
    return null;
  }

  const afterMarker = pathPart.slice(markerIndex + JOIN_MARKER.length);
  const slugSegment = afterMarker.split('/')[0] ?? '';
  if (!slugSegment) {
    return null;
  }

  const slug = safeDecode(slugSegment);
  const serviceId = queryPart ? extractServiceId(queryPart) : undefined;

  return serviceId !== undefined ? { slug, serviceId, source: 'qr' } : { slug, source: 'qr' };
}

/**
 * Build the join deep link for a `slug` (+ optional `serviceId`) in the
 * `qr-code.service` format. The exact inverse of {@link parseDiscoveryUrl};
 * exported so the Property 1 round-trip test (task 7.2) can generate URLs.
 *
 * @param base The deep-link base (e.g. `https://app.queuenow.com`).
 * @param slug The organization slug.
 * @param serviceId Optional service id for a service-specific QR.
 * @returns The encoded deep-link URL.
 */
export function buildJoinDeepLink(base: string, slug: string, serviceId?: string): string {
  const trimmedBase = base.replace(/\/+$/, '');
  const path = `${trimmedBase}${JOIN_MARKER}${encodeURIComponent(slug)}`;
  return serviceId !== undefined && serviceId !== ''
    ? `${path}?${SERVICE_PARAM}=${encodeURIComponent(serviceId)}`
    : path;
}

/**
 * Build a {@link DiscoveryTarget} from a manually entered organization code
 * (R1.2). Returns `null` for blank input. The entered code is treated as the
 * org identifier/slug (see {@link resolveOrgIdentifier}).
 *
 * @param code The organization code typed by the customer.
 * @returns The parsed target with `source: 'manual'`, or `null` when blank.
 */
export function manualDiscoveryTarget(code: string): DiscoveryTarget | null {
  if (typeof code !== 'string') {
    return null;
  }
  const slug = code.trim();
  if (slug === '') {
    return null;
  }
  return { slug, source: 'manual' };
}

/**
 * Resolve the org identifier used to call the org-id-scoped public status
 * endpoint (`GET /organizations/:orgId/queue/status`).
 *
 * SLUG → ORG-ID RESOLUTION (documented assumption): the public status endpoint
 * is org-id-scoped and `apps/api` currently exposes NO public slug→orgId lookup
 * (the web kiosk likewise addresses organizations by id, e.g. `/kiosk/:orgId`).
 * The design's "Discovery note" anchors slug resolution to "the same public
 * status/lookup path the web kiosk uses for slug joins" — which, today, means
 * addressing the org directly by the identifier carried in the deep-link path
 * segment. We therefore treat that path segment (the parsed `slug`) as the org
 * identifier when no explicit `orgId` is present, preferring `orgId` when it is.
 * If/when the backend adds a public slug→orgId lookup, only this resolver and
 * the status hook need to change — the parser and the decision stay the same.
 *
 * @param target The discovery target to resolve.
 * @returns The org identifier to query with, or `null` when none is available.
 */
export function resolveOrgIdentifier(target: DiscoveryTarget): string | null {
  return target.orgId ?? target.slug ?? null;
}

/** Decode a URI component, falling back to the raw value if decoding fails. */
function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/** Extract a non-empty, decoded `service` value from a raw query string. */
function extractServiceId(queryPart: string): string | undefined {
  for (const pair of queryPart.split('&')) {
    const eqIndex = pair.indexOf('=');
    if (eqIndex === -1) {
      continue;
    }
    const key = pair.slice(0, eqIndex);
    const rawValue = pair.slice(eqIndex + 1);
    if (key === SERVICE_PARAM && rawValue !== '') {
      return safeDecode(rawValue);
    }
  }
  return undefined;
}
