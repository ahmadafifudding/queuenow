// Feature: web-app, Property 15: Staff pagination round-trips through the URL search params
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import { queryKeys } from '@/lib/api/query-keys';

import {
  DEFAULT_STAFF_PAGE,
  parsePage,
  validateStaffSearch,
  type StaffSearch,
} from '../lib/search';

/**
 * Property 15 — Validates: Requirements 10.2
 *
 * Staff list pagination is driven from the route search params so the current
 * page is shareable and back-button friendly. The pure codec under test is the
 * route's `validateSearch` (`validateStaffSearch`) and its `parsePage` helper in
 * `features/staff/lib/search.ts`, together with the `queryKeys.staff` factory
 * that turns the parsed page into the `['staff', orgId, page]` query key.
 *
 * We assert the URL ↔ state round-trip end-to-end:
 *   1. Writing a normalized page to the URL search params and reading it back
 *      reproduces the same effective page (and the same query key).
 *   2. The normalizer is total and stable — every input yields a defined page
 *      `>= 1` and an already-normalized page is a fixed point.
 *   3. Invalid / garbage / missing search input falls back to the default page
 *      (1) instead of throwing.
 *
 * The codec never invents its own URL format, so to exercise the real
 * URL boundary we serialize through `URLSearchParams` exactly as a browser hard
 * navigation would: a `page` value leaves as a string and arrives back as a
 * string, which `validateStaffSearch` must coerce.
 */

/**
 * Serialize a page into a raw search object the way the router would observe it
 * after a hard navigation: routed through a real query string so the value is a
 * string (or `null` when absent), never a live number reference.
 */
function serializePageToSearch(page: number): Record<string, unknown> {
  const written = new URLSearchParams({ page: String(page) });
  const readBack = new URLSearchParams(written.toString());
  return { page: readBack.get('page') };
}

/** A representative organization id for the query-key round-trip. */
const orgId: fc.Arbitrary<string> = fc.string({ minLength: 1, maxLength: 24 });

/** Already-normalized, valid 1-indexed pages (the effective page space). */
const normalizedPage: fc.Arbitrary<number> = fc.integer({
  min: DEFAULT_STAFF_PAGE,
  max: 1_000_000,
});

/**
 * Arbitrary raw `search.page` inputs spanning everything the URL can deliver:
 * valid ints, numeric strings, negatives, zero, fractional values, blank/garbage
 * strings, and missing/`null`/`undefined`. Drives the parser directly to prove
 * it is total and never throws.
 */
const rawSearchPage: fc.Arbitrary<unknown> = fc.oneof(
  fc.integer(),
  fc.integer().map((n) => String(n)),
  fc.float({ noNaN: true }),
  fc.float({ noNaN: true }).map((n) => String(n)),
  fc.constantFrom('', '   ', 'abc', 'NaN', 'Infinity', '1.5e2', '0x10', '1,000'),
  fc.constantFrom<unknown>(undefined, null, true, false, {}, []),
);

describe('Property 15: staff pagination round-trips through the URL search params', () => {
  it('round-trips a normalized page through the URL search params to the same page', () => {
    fc.assert(
      fc.property(normalizedPage, (page) => {
        const search: StaffSearch = validateStaffSearch(serializePageToSearch(page));
        expect(search.page).toBe(page);
      }),
      { numRuns: 200 },
    );
  });

  it('round-trips a normalized page through the URL to the same query key', () => {
    fc.assert(
      fc.property(orgId, normalizedPage, (org, page) => {
        const { page: reread } = validateStaffSearch(serializePageToSearch(page));
        expect(queryKeys.staff(org, reread)).toEqual(queryKeys.staff(org, page));
      }),
      { numRuns: 200 },
    );
  });

  it('normalizes every input to a defined integer page >= 1 without throwing', () => {
    fc.assert(
      fc.property(rawSearchPage, (value) => {
        const page = parsePage(value);
        expect(Number.isInteger(page)).toBe(true);
        expect(page).toBeGreaterThanOrEqual(DEFAULT_STAFF_PAGE);
      }),
      { numRuns: 200 },
    );
  });

  it('treats the effective page as a stable fixed point under re-parse and re-serialize', () => {
    fc.assert(
      fc.property(rawSearchPage, (value) => {
        const effective = parsePage(value);
        // Parsing the already-normalized page is idempotent...
        expect(parsePage(effective)).toBe(effective);
        // ...and so is a full URL round-trip of that effective page.
        expect(validateStaffSearch(serializePageToSearch(effective)).page).toBe(effective);
      }),
      { numRuns: 200 },
    );
  });

  it('falls back to the default page for invalid / missing search input', () => {
    const invalidPage: fc.Arbitrary<unknown> = fc.oneof(
      fc.constantFrom<unknown>(undefined, null, '', '   ', 'abc', 'NaN', true, false, {}, []),
      // Out-of-range numbers (zero / negatives) also clamp to the default page.
      fc.integer({ min: -1_000_000, max: 0 }),
      fc.integer({ min: -1_000_000, max: 0 }).map((n) => String(n)),
    );

    fc.assert(
      fc.property(invalidPage, (value) => {
        expect(validateStaffSearch({ page: value }).page).toBe(DEFAULT_STAFF_PAGE);
      }),
      { numRuns: 200 },
    );
  });
});
