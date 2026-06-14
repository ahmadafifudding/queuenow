/**
 * Ticket-status query hook (R3.1, R3.2, R3.3, R9.4).
 *
 * {@link useTicketStatus} reads a single ticket's live state through the shared
 * `apiClient` + TanStack Query on the central `queryKeys.ticket` key
 * (`GET /organizations/:orgId/queue/ticket/:ticketId`, R3.2). REST is the single
 * source of truth: the socket bridge (task 3.1) invalidates this exact key on
 * `ticket:update`, so a realtime event drives a refetch here (R3.3) rather than
 * a parallel store; a manual pull-to-refresh and a connectivity-restore refetch
 * (R9.3/R9.4) go through the returned `refetch` too.
 *
 * The endpoint is public, so the request is unauthenticated; a missing/expired
 * ticket surfaces as an `ApiError` whose `code` the screen maps to copy.
 */
import { useQuery, type UseQueryResult } from '@tanstack/react-query';

import { apiClient as defaultApiClient, type ApiClient } from '@/lib/api/client';
import { queryKeys } from '@/lib/api/query-keys';
import type { TicketStatusView } from '@/lib/view-models';

/** Build the public ticket-status path (R3.2). Ids are URL-encoded. */
export function ticketStatusPath(orgId: string, ticketId: string): string {
  return `/organizations/${encodeURIComponent(orgId)}/queue/ticket/${encodeURIComponent(ticketId)}`;
}

/** Injectable boundaries for {@link useTicketStatus}; defaults to the shared client. */
export interface UseTicketStatusDeps {
  /** REST client used to GET the ticket. Defaults to the shared {@link apiClient}. */
  apiClient?: ApiClient;
}

/**
 * Fetch a ticket's current tracking state (R3.2).
 *
 * The query is disabled until both ids are present. It keys on
 * `queryKeys.ticket(orgId, ticketId)` so the socket bridge's invalidation
 * (R3.3) and the manual/connectivity refresh (R9.3/R9.4) all refetch the same
 * entry.
 *
 * @param orgId The organization the ticket belongs to.
 * @param ticketId The ticket to track.
 * @param deps Optional injected boundaries (for tests).
 * @returns The TanStack Query result for the ticket status.
 */
export function useTicketStatus(
  orgId: string | null | undefined,
  ticketId: string | null | undefined,
  deps: UseTicketStatusDeps = {},
): UseQueryResult<TicketStatusView> {
  const api = deps.apiClient ?? defaultApiClient;
  const enabled = Boolean(orgId) && Boolean(ticketId);

  return useQuery({
    queryKey: queryKeys.ticket(orgId ?? '', ticketId ?? ''),
    enabled,
    queryFn: async (): Promise<TicketStatusView> => {
      // `enabled` guarantees both ids are present by the time this runs.
      const { data } = await api.get<TicketStatusView>(
        ticketStatusPath(orgId as string, ticketId as string),
      );
      return data;
    },
  });
}
