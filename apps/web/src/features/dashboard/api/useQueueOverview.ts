/*
 * useQueueOverview — live per-service queue snapshot for the dashboard home.
 *
 * Reads the org's queue status (`GET /organizations/:orgId/queue/status`)
 * through the single API_Client on the CENTRAL `queryKeys.queue(orgId)` key —
 * the same key the socket bridge and polling fallback invalidate — and polls on
 * an interval so the dashboard's "now calling" strip and per-service breakdown
 * stay current without a dedicated socket on this route.
 */
import { useQuery, type UseQueryResult } from '@tanstack/react-query';

import { apiClient, type ApiError } from '@/lib/api/client';
import { queryKeys } from '@/lib/api/query-keys';

import type { QueueOverview } from '../types';

/** How often (ms) to refresh the dashboard queue overview. */
export const QUEUE_OVERVIEW_REFETCH_MS = 10_000;

/** Path to the public queue-status read (mirrors the queue/display features). */
function statusPath(orgId: string): string {
  return `/organizations/${orgId}/queue/status`;
}

/** Options controlling the queue-overview query. */
export interface UseQueueOverviewOptions {
  /** The organization whose queue overview to load. */
  orgId: string;
  /** When `false`, the query does not run. Defaults to `true`. */
  enabled?: boolean;
}

/**
 * Load (and poll) the org's per-service queue overview for the dashboard.
 *
 * @param options - the org plus enablement.
 * @returns The TanStack Query result holding the {@link QueueOverview}.
 */
export function useQueueOverview(
  options: UseQueueOverviewOptions,
): UseQueryResult<QueueOverview, ApiError> {
  const { orgId, enabled = true } = options;

  return useQuery<QueueOverview, ApiError>({
    queryKey: queryKeys.queue(orgId),
    queryFn: async ({ signal }) => {
      const { data } = await apiClient.get<QueueOverview>(statusPath(orgId), { signal });
      return data;
    },
    enabled: enabled && Boolean(orgId),
    refetchInterval: QUEUE_OVERVIEW_REFETCH_MS,
  });
}
