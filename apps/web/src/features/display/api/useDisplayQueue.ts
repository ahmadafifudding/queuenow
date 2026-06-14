/*
 * useDisplayQueue — public, read-only queue query for the Display board (R7.1,
 * R7.2).
 *
 * The Display reads the org's queue status through the single API_Client and
 * the CENTRAL queue query key (`queryKeys.queue(orgId)`). Using that exact key
 * is what makes the board live: the socket event bridge (`lib/socket.ts`) and
 * the polling fallback (`hooks/usePollingFallback`) both invalidate
 * `queryKeys.queue(orgId)` on `queue:update` / `queue:ticket-called`, so a call
 * event re-fetches this query and the board updates with no bespoke wiring
 * (R7.3, R7.9).
 *
 * The board connects to the socket in `'public'` mode (token-less) and the
 * API_Client attaches no Bearer header when the Auth_Store has no token, so
 * this read is fully unauthenticated — no auth, no mutations (R7.1).
 */
import { useQuery, type UseQueryResult } from '@tanstack/react-query';

import { apiClient, type ApiError } from '@/lib/api/client';
import { queryKeys } from '@/lib/api/query-keys';

import type { DisplayQueueStatus } from '../types';
import { displayEndpoints } from './endpoints';

/** Options controlling the public display queue query. */
export interface UseDisplayQueueOptions {
  /** The organization whose queue status to display. */
  orgId: string;
  /**
   * When `false`, the query does not run (e.g. while `orgId` is unknown).
   * Defaults to `true`.
   */
  enabled?: boolean;
}

/**
 * Load the current public queue status for an organization for the Display
 * board.
 *
 * @param options - the org plus enablement.
 * @returns The TanStack Query result holding the {@link DisplayQueueStatus}.
 */
export function useDisplayQueue(
  options: UseDisplayQueueOptions,
): UseQueryResult<DisplayQueueStatus, ApiError> {
  const { orgId, enabled = true } = options;

  return useQuery<DisplayQueueStatus, ApiError>({
    queryKey: queryKeys.queue(orgId),
    queryFn: async ({ signal }) => {
      const { data } = await apiClient.get<DisplayQueueStatus>(displayEndpoints.status(orgId), {
        signal,
      });
      return data;
    },
    enabled: enabled && Boolean(orgId),
  });
}
