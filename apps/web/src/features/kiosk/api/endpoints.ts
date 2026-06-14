/*
 * Public REST paths used by the Kiosk (R12.1 — no auth).
 *
 * Paths are relative to `env.VITE_API_URL`; the API_Client prefixes the base
 * URL/origin, so they never include it. All three reads/writes below are
 * unauthenticated: the Kiosk connects with no token and the API_Client attaches
 * no Bearer header when the Auth_Store is empty.
 *
 * Endpoint inventory & ASSUMPTIONS (verified against `apps/api`):
 *
 * 1. `activeServices` → `GET /organizations/:orgId/queue/status`
 *    VERIFIED public (`QueueController.getCurrentStatus`, `@Public()`). The
 *    response's `services[]` only contains ACTIVE services (the service query
 *    filters `isActive: true`), each carrying `{ id, name, prefix }` — exactly
 *    the selectable services the Kiosk needs (R12.2). We reuse this rather than
 *    `GET /services`, which is auth-guarded (OWNER/ADMIN/STAFF) and not usable
 *    from a public kiosk.
 *
 * 2. `queueSettings` → `GET /organizations/:orgId/queue/settings`
 *    ASSUMED public. At the time of writing `apps/api` only exposes queue
 *    settings via the AUTH-guarded `GET /organizations/:id/settings`
 *    (OWNER/ADMIN). The Kiosk needs `requireName`/`requirePhone` WITHOUT auth,
 *    so this module assumes a public, read-only settings endpoint under the
 *    already-public `/queue` namespace. `useQueueSettings` degrades gracefully
 *    (safe default: nothing required) if this endpoint is missing, so the Kiosk
 *    keeps working until the backend adds it.
 *
 * 3. `join` → `POST /organizations/:orgId/queue/join`
 *    VERIFIED public (`QueueController.joinQueue`, `@Public()`). Accepts the
 *    `joinQueueSchema` body and returns the issued ticket (R12.4). A full daily
 *    queue is surfaced as the `QUEUE_FULL` error code, which the Kiosk maps to a
 *    "queue is full" message (R12.6).
 */
export const kioskEndpoints = {
  /** GET active services for an org (public; via the queue-status aggregate). */
  activeServices: (orgId: string): string => `/organizations/${orgId}/queue/status`,
  /** GET the org's public queue settings (assumed public — see file header). */
  queueSettings: (orgId: string): string => `/organizations/${orgId}/queue/settings`,
  /** POST a new ticket into the queue (public join). */
  join: (orgId: string): string => `/organizations/${orgId}/queue/join`,
} as const;
