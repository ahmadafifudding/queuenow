/*
 * Centralized REST paths for the organization feature (settings + branding).
 *
 * Verified against apps/api `OrganizationController` (`@Controller('organizations')`):
 *   GET    /organizations/:id            → org details (incl. branding + settings)
 *   PATCH  /organizations/:id            → update org details   (OWNER / ADMIN)
 *   PATCH  /organizations/:id/branding   → update branding      (OWNER / ADMIN)
 *   GET    /organizations/:id/settings   → queue settings       (OWNER / ADMIN)
 *   PATCH  /organizations/:id/settings   → update queue settings (OWNER / ADMIN)
 *
 * ASSUMPTION (documented): the backend controller does not currently expose a
 * delete-organization route. The OWNER-only delete control (R11.7) targets the
 * conventional `DELETE /organizations/:id`; the mutation hook is wired to that
 * path so visibility/gating is correct and the call lights up once the backend
 * adds the endpoint. Keeping every path here means there is a single place to
 * update if the backend route shape changes (or once `schema.d.ts` covers them).
 *
 * Paths are relative to `env.VITE_API_URL` — the API_Client prefixes the base
 * URL, so these never include the origin or the `/api/v1` prefix (mirrors the
 * queue feature's `endpoints.ts`).
 */
export const organizationEndpoints = {
  /** GET organization details, including branding + settings (OWNER / ADMIN). */
  details: (orgId: string): string => `/organizations/${orgId}`,
  /** PATCH organization details — name/address/phone/email/timezone (R11.1). */
  update: (orgId: string): string => `/organizations/${orgId}`,
  /** PATCH organization branding — logoUrl/primaryColor/qrText (R11.2). */
  branding: (orgId: string): string => `/organizations/${orgId}/branding`,
  /** GET the org's queue settings. */
  settings: (orgId: string): string => `/organizations/${orgId}/settings`,
  /** PATCH the org's queue settings — resetTime/maxRecall/requireName/… (R11.6). */
  updateSettings: (orgId: string): string => `/organizations/${orgId}/settings`,
  /** DELETE the organization (OWNER only, R11.7). See ASSUMPTION above. */
  delete: (orgId: string): string => `/organizations/${orgId}`,
} as const;
