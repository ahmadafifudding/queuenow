/*
 * useQueueStatus — TanStack Query hook for the staff queue-serving panel (R6.1).
 *
 * Reads the org's current queue status (optionally scoped to a single service)
 * through the single API_Client and the central queue query key, so the socket
 * bridge (`lib/socket.ts`) and the polling fallback (`hooks/usePollingFallback`)
 * can invalidate the exact same key to push live updates into this query
 * (R3.6, R6.12). Feature code never calls `fetch` directly — all server
 * interaction flows through this colocated hook (steering "API Layer", R2.1).
 */
import { useQuery, type UseQueryResult } from '@tanstack/react-query';

import { type ApiError, apiClient } from '@/lib/api/client';
import { queryKeys } from '@/lib/api/query-keys';

import type { QueueStatusResponse } from '../types';
import { queueEndpoints } from './endpoints';

/** Options controlling the queue-status query. */
export interface UseQueueStatusOptions {
  /** The organization whose queue status to load. */
  orgId: string;
  /** Optional service to scope the status to a single service. */
  serviceId?: string;
  /**
   * When `false`, the query does not run (e.g. while `orgId` is unknown).
   * Defaults to `true`.
   */
  enabled?: boolean;
}

/**
 * Load the current queue status for an organization.
 *
 * @param options - the org (and optional service) plus enablement.
 * @returns The TanStack Query result holding the {@link QueueStatusResponse}.
 */
export function useQueueStatus(
  options: UseQueueStatusOptions,
): UseQueryResult<QueueStatusResponse, ApiError> {
  const { orgId, serviceId, enabled = true } = options;

  return useQuery<QueueStatusResponse, ApiError>({
    queryKey: queryKeys.queue(orgId, serviceId),
    queryFn: async ({ signal }) => {
      const basePath = queueEndpoints.status(orgId);
      const path = serviceId ? `${basePath}?serviceId=${encodeURIComponent(serviceId)}` : basePath;
      const { data } = await apiClient.get<QueueStatusResponse>(path, { signal });
      return data;
    },
    enabled: enabled && Boolean(orgId),
  });
}
