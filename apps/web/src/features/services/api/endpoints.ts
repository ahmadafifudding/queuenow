/*
 * Centralized REST paths for the services feature (task 11.1).
 *
 * The backend mounts services CRUD under `organizations/:orgId/services` (see
 * apps/api `ServiceController`, `@Controller('organizations/:orgId/services')`):
 *   - GET    /organizations/:orgId/services        → list (OWNER/ADMIN/STAFF)
 *   - POST   /organizations/:orgId/services        → create (OWNER/ADMIN)
 *   - PATCH  /organizations/:orgId/services/:id     → update / toggle (OWNER/ADMIN)
 *   - DELETE /organizations/:orgId/services/:id     → remove (OWNER/ADMIN)
 *
 * Keeping the path builders in one place means a single spot to update if the
 * backend route shape changes (mirrors `features/queue/api/endpoints.ts`).
 *
 * Paths are relative to `env.VITE_API_URL` — the API_Client prefixes the base
 * URL, so these never include the origin or the `/api/v1` prefix.
 */
export const serviceEndpoints = {
  /** GET the org's services / POST a new service. */
  list: (orgId: string): string => `/organizations/${orgId}/services`,
  /** PATCH (update / toggle) or DELETE a single service by id. */
  detail: (orgId: string, serviceId: string): string =>
    `/organizations/${orgId}/services/${serviceId}`,
} as const;
