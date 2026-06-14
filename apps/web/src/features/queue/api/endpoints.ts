/*
 * Centralized REST paths for the queue feature.
 *
 * The backend mounts queue routes under `organizations/:orgId/queue/*` and
 * counters under `organizations/:orgId/counters` (see apps/api
 * `QueueController` / `CounterController`). Keeping the path builders in one
 * place means that if the backend route shape changes (or once the generated
 * `schema.d.ts` covers these endpoints), there is a single spot to update
 * rather than string literals scattered across hooks.
 *
 * Paths are relative to `env.VITE_API_URL` — the API_Client prefixes the base
 * URL, so these never include the origin or the `/api/v1` prefix.
 */
export const queueEndpoints = {
  /** GET current queue status for an org (public). Add `?serviceId=` to scope. */
  status: (orgId: string): string => `/organizations/${orgId}/queue/status`,
  /** GET the org's counters (auth required: OWNER / ADMIN / STAFF). */
  counters: (orgId: string): string => `/organizations/${orgId}/counters`,

  // --- Serving actions (auth required: OWNER / ADMIN / STAFF) ----------------
  // Verified against apps/api `QueueController` (task 8.2). Call-next posts the
  // counter id in the body; the per-ticket actions encode the ticket id in the
  // path. All are `POST` and return the updated ticket.

  /** POST call the next WAITING ticket for the counter's service (body: `{ counterId }`). */
  callNext: (orgId: string): string => `/organizations/${orgId}/queue/call-next`,
  /** POST recall a CALLED ticket (bumps its recall count, up to the org's `maxRecall`). */
  recall: (orgId: string, ticketId: string): string =>
    `/organizations/${orgId}/queue/${ticketId}/recall`,
  /** POST skip a CALLED ticket (moves it to SKIPPED). */
  skip: (orgId: string, ticketId: string): string =>
    `/organizations/${orgId}/queue/${ticketId}/skip`,
  /** POST complete a CALLED/SERVING ticket (moves it to COMPLETED). */
  complete: (orgId: string, ticketId: string): string =>
    `/organizations/${orgId}/queue/${ticketId}/complete`,
  /** POST rejoin a SKIPPED ticket back into WAITING. */
  rejoin: (orgId: string, ticketId: string): string =>
    `/organizations/${orgId}/queue/${ticketId}/rejoin`,
} as const;
