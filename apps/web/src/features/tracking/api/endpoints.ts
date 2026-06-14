/*
 * Centralized REST path for the public ticket-tracking read.
 *
 * The backend mounts the public ticket-status endpoint at
 * `organizations/:orgId/queue/ticket/:ticketId` (see apps/api `QueueController`,
 * `@Public()`). Paths are relative to `env.VITE_API_URL` — the API_Client
 * prefixes the base URL.
 */
export const trackingEndpoints = {
  /** GET public status for a single ticket (no auth required). */
  ticket: (orgId: string, ticketId: string): string =>
    `/organizations/${orgId}/queue/ticket/${ticketId}`,
} as const;
