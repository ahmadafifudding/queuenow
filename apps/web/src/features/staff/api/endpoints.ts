/*
 * Centralized REST paths for the staff feature.
 *
 * The backend mounts staff routes under `organizations/:orgId/staff` (see
 * apps/api `StaffController`): `GET ''` lists members and `POST 'invite'`
 * creates an invitation. Keeping the path builders in one place means a single
 * spot to update if the backend route shape changes (or once the generated
 * `schema.d.ts` covers these endpoints).
 *
 * ## Pagination assumption (R10.1, R10.2)
 * The design calls for a paginated list driven by the envelope `meta`. The
 * current controller does not yet read `page`/`limit`, but adding the query
 * params is forward-compatible: an endpoint that ignores them returns the first
 * page unchanged, and one that honors them returns `meta`. So {@link list}
 * always sends `?page=&limit=` and the list hook reads `meta` when present.
 *
 * Paths are relative to `env.VITE_API_URL` — the API_Client prefixes the base
 * URL, so these never include the origin or the `/api/v1` prefix.
 */

/** Query options for the paginated staff list. */
export interface StaffListQuery {
  /** 1-indexed page to request. */
  page: number;
  /** Page size. */
  limit: number;
}

export const staffEndpoints = {
  /**
   * GET the org's staff members, paginated (auth: OWNER / ADMIN).
   * Sends `?page=&limit=`; the API_Client surfaces the envelope `meta`.
   */
  list: (orgId: string, query: StaffListQuery): string => {
    const params = new URLSearchParams({
      page: String(query.page),
      limit: String(query.limit),
    });
    return `/organizations/${orgId}/staff?${params.toString()}`;
  },

  /** POST invite a staff member to the org (auth: OWNER / ADMIN). */
  invite: (orgId: string): string => `/organizations/${orgId}/staff/invite`,
} as const;
