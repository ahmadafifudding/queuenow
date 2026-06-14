/*
 * useTicketStatus — public, read-only query for the customer ticket-tracking
 * page (R12.5). Reads the org's public ticket-status endpoint through the single
 * API_Client and the central `queryKeys.ticket(orgId, ticketId)` key.
 *
 * The page is unauthenticated: the API_Client attaches no Bearer header when the
 * Auth_Store has no token. Because the customer page has no socket of its own,
 * liveness comes from polling: while the ticket is in a non-terminal state
 * (WAITING / CALLED / SERVING) the query refetches on an interval; once it
 * reaches a terminal state (COMPLETED / SKIPPED) polling stops.
 */
import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { TicketStatus } from '@queuenow/shared-types';

import { apiClient, type ApiError } from '@/lib/api/client';
import { queryKeys } from '@/lib/api/query-keys';

import type { TrackedTicket } from '../types';
import { trackingEndpoints } from './endpoints';

/** How often (ms) to refetch while the ticket is still active. */
export const TRACKING_POLL_INTERVAL_MS = 7_000;

/** Statuses after which the ticket no longer changes, so polling can stop. */
const TERMINAL_STATUSES: ReadonlySet<TicketStatus> = new Set([
  TicketStatus.COMPLETED,
  TicketStatus.SKIPPED,
]);

/** Whether a status is terminal (no further updates expected). */
export function isTerminalStatus(status: TicketStatus): boolean {
  return TERMINAL_STATUSES.has(status);
}

/** Options controlling the public ticket-status query. */
export interface UseTicketStatusOptions {
  /** The organization the ticket belongs to. */
  orgId: string;
  /** The ticket to track. */
  ticketId: string;
  /** When `false`, the query does not run. Defaults to `true`. */
  enabled?: boolean;
}

/**
 * Load (and poll) the public status of a single ticket.
 *
 * @param options - the org + ticket plus enablement.
 * @returns The TanStack Query result holding the {@link TrackedTicket}.
 */
export function useTicketStatus(
  options: UseTicketStatusOptions,
): UseQueryResult<TrackedTicket, ApiError> {
  const { orgId, ticketId, enabled = true } = options;

  return useQuery<TrackedTicket, ApiError>({
    queryKey: queryKeys.ticket(orgId, ticketId),
    queryFn: async ({ signal }) => {
      const { data } = await apiClient.get<TrackedTicket>(
        trackingEndpoints.ticket(orgId, ticketId),
        { signal },
      );
      return data;
    },
    enabled: enabled && Boolean(orgId) && Boolean(ticketId),
    // Poll while active; stop once the ticket reaches a terminal state.
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      if (status !== undefined && isTerminalStatus(status)) {
        return false;
      }
      return TRACKING_POLL_INTERVAL_MS;
    },
  });
}
