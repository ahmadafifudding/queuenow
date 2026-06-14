/*
 * Staff list URL search-param handling (Requirements 10.2, design Property 15).
 *
 * Staff list pagination is driven from the route search params so the current
 * page is shareable and back-button friendly (steering "Pagination" — page in
 * the URL). The route's `validateSearch` parses the raw search object into a
 * typed {@link StaffSearch}; the component reads it back to build the
 * `['staff', orgId, page]` query key. Keeping the parser pure and centralized
 * here means the route and the page round-trip property test share one source
 * of truth for how a page maps to/from the URL.
 */

/** The first (and default) staff list page. Pages are 1-indexed. */
export const DEFAULT_STAFF_PAGE = 1;

/** Page size requested from the staff list endpoint. */
export const STAFF_PAGE_SIZE = 20;

/** Validated shape of the staff route's search params. */
export interface StaffSearch {
  /** The 1-indexed page currently being viewed. */
  page: number;
}

/**
 * Coerce an unknown search value into a valid 1-indexed page number.
 *
 * Accepts a number or a numeric string (search params arrive as strings on a
 * hard navigation). Anything missing, non-numeric, non-finite, or below 1
 * falls back to {@link DEFAULT_STAFF_PAGE}; fractional values are floored. This
 * guarantees the query key is always driven by a clean integer page.
 *
 * @param value Raw `search.page` from the URL.
 * @returns A page integer `>= 1`.
 */
export function parsePage(value: unknown): number {
  const numeric = typeof value === 'number' ? value : Number(value);

  if (!Number.isFinite(numeric)) {
    return DEFAULT_STAFF_PAGE;
  }

  const page = Math.floor(numeric);
  return page < DEFAULT_STAFF_PAGE ? DEFAULT_STAFF_PAGE : page;
}

/**
 * `validateSearch` for the staff route: parse the raw search object into a typed
 * {@link StaffSearch}. Pure and total — every input yields a defined page — so
 * the page round-trips through the URL (Property 15).
 *
 * @param search The raw, untyped search params object from the router.
 * @returns The validated staff search params.
 */
export function validateStaffSearch(search: Record<string, unknown>): StaffSearch {
  return { page: parsePage(search.page) };
}
