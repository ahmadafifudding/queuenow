// Feature: customer-mobile-app, Property 1: QR / deep-link parse round-trips.
// For any organization slug and optional serviceId, building the join deep-link
// URL in the qr-code.service format (`{base}/join/{slug}` or
// `{base}/join/{slug}?service={serviceId}`) and then parsing it into a
// DiscoveryTarget yields the same slug and serviceId (and `source: 'qr'`).
//
// Validates: Requirements 1.1
//
// `buildJoinDeepLink` and `parseDiscoveryUrl` are PURE, side-effect-free
// functions. The only thing the module imports is the `DiscoveryTarget` *type*
// (erased at compile time); it pulls in no expo-* native modules, so this
// property needs none of the native-module `vi.mock` stubs the client tests use.
//
// Generators: the builder encodes both `slug` and `serviceId` with
// `encodeURIComponent`, so any character that could break the URL (`/`, `?`,
// `#`, `&`, `=`, whitespace, unicode) is percent-escaped and faithfully decoded
// by the parser's `safeDecode`. We therefore generate broad `fullUnicode`
// strings for slug/serviceId (avoiding only lone surrogates, which
// `encodeURIComponent` rejects — an input outside the round-trip's domain, not
// a parser concern). The base is constrained to be parser-consistent: a real
// scheme+host with optional non-`join` path segments and no `?`/`#`, so the
// only `/join/` marker and the only `?` in the URL are the ones the builder
// introduces.
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { buildJoinDeepLink, parseDiscoveryUrl } from '@/features/discovery/parse-discovery-url';

/**
 * An organization slug. Any non-empty unicode string: the builder
 * percent-encodes it, so it round-trips regardless of content. `fullUnicode`
 * avoids lone surrogates that would make `encodeURIComponent` throw.
 */
const slugArb: fc.Arbitrary<string> = fc.fullUnicodeString({ minLength: 1 });

/**
 * A service id. Non-empty for the same reason as the slug; the builder treats
 * an empty-string serviceId as "no service" (omits the query param), so it is
 * excluded from the "serviceId present" space here.
 */
const serviceIdArb: fc.Arbitrary<string> = fc.fullUnicodeString({ minLength: 1 });

/**
 * Optional serviceId: either absent (`undefined`) — a plain org QR — or a
 * non-empty id — a service-specific QR (R1.1).
 */
const optionalServiceIdArb: fc.Arbitrary<string | undefined> = fc.option(serviceIdArb, {
  nil: undefined,
});

/**
 * A single safe path segment for the base URL: alphanumeric/dash, non-empty,
 * and never the reserved `join` marker (so it can't be mistaken for the join
 * segment the builder appends).
 */
const safeSegmentArb: fc.Arbitrary<string> = fc
  .string({ minLength: 1, maxLength: 12 })
  .map((s) => s.replace(/[^a-zA-Z0-9-]/g, ''))
  .filter((s) => s.length > 0 && s.toLowerCase() !== 'join');

/**
 * A parser-consistent deep-link base: `scheme + host` with optional extra path
 * segments and an optional trailing slash (which the builder trims). It never
 * contains a `/join/` segment, a `?`, a `#`, or whitespace, so the only join
 * marker and query string in the final URL come from the builder itself.
 */
const baseArb: fc.Arbitrary<string> = fc
  .tuple(
    fc.constantFrom('https://', 'http://'),
    fc.constantFrom('app.queuenow.com', 'queue.example.org', 'localhost:3000', 'my-org.app'),
    fc.array(safeSegmentArb, { maxLength: 3 }),
    fc.boolean(),
  )
  .map(([scheme, host, segments, trailingSlash]) => {
    const path = segments.length > 0 ? `/${segments.join('/')}` : '';
    return `${scheme}${host}${path}${trailingSlash ? '/' : ''}`;
  });

describe('Property 1: QR / deep-link parse round-trips', () => {
  it('round-trips slug and optional serviceId through buildJoinDeepLink → parseDiscoveryUrl', () => {
    fc.assert(
      fc.property(baseArb, slugArb, optionalServiceIdArb, (base, slug, serviceId) => {
        const url = buildJoinDeepLink(base, slug, serviceId);
        const target = parseDiscoveryUrl(url);

        // A well-formed join deep link always parses (never null).
        expect(target).not.toBeNull();
        // The parsed target is always sourced from the scanned QR.
        expect(target?.source).toBe('qr');
        // The slug survives the encode → decode round-trip exactly.
        expect(target?.slug).toBe(slug);
        // The optional serviceId survives exactly: a non-empty id is preserved,
        // and an absent id stays absent (`undefined`).
        expect(target?.serviceId).toBe(serviceId);
      }),
      { numRuns: 100 },
    );
  });
});
