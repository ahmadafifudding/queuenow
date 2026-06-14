/*
 * Centralized REST paths for the counters management feature (R9).
 *
 * Verified against apps/api `CounterController`
 * (`@Controller('organizations/:orgId/counters')`):
 *   - POST   organizations/:orgId/counters        create  (OWNER/ADMIN)
 *   - GET    organizations/:orgId/counters        list    (OWNER/ADMIN/STAFF)
 *   - PATCH  organizations/:orgId/counters/:id     update  (OWNER/ADMIN)
 *   - DELETE organizations/:orgId/counters/:id     delete  (OWNER/ADMIN)
 *
 * A counter is associated with a service, so the form needs the org's services
 * to pick from. The service list lives under
 * `@Controller('organizations/:orgId/services')` (GET, OWNER/ADMIN/STAFF), so
 * that path is centralized here too.
 *
 * Assumptions:
 *   - There is no dedicated "toggle active" endpoint; toggling active state is a
 *     PATCH of the counter with `{ isActive }` (mirrors how services toggle).
 *   - Paths are relative to `env.VITE_API_URL` — the API_Client prefixes the
 *     base URL, so these never include the origin or the `/api/v1` prefix.
 */
export const counterEndpoints = {
  /** GET the org's counters (auth: OWNER / ADMIN / STAFF). */
  list: (orgId: string): string => `/organizations/${orgId}/counters`,
  /** POST create a counter (auth: OWNER / ADMIN). */
  create: (orgId: string): string => `/organizations/${orgId}/counters`,
  /** PATCH update a counter — also used to toggle `isActive` (auth: OWNER / ADMIN). */
  update: (orgId: string, counterId: string): string =>
    `/organizations/${orgId}/counters/${counterId}`,
  /** GET the org's services, used to populate the counter form's service picker. */
  services: (orgId: string): string => `/organizations/${orgId}/services`,
} as const;
