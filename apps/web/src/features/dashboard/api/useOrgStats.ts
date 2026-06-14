/*
 * useOrgStats — today's queue statistics for the dashboard home.
 *
 * Reads `GET /organizations/:id/stats` (OWNER / ADMIN) through the single
 * API_Client and the central `queryKeys.orgStats(orgId)` key. Refetches on a
 * modest interval so the summary stays current as staff serve the queue.
 */
import { useQuery, type UseQueryResult } from '@tanstack/react-query';

import { apiClient, type ApiError } from '@/lib/api/client';
import { queryKeys } from '@/lib/api/query-keys';
import { organizationEndpoints } from '@/features/organization/api/endpoints';

import type { OrgStats } from '../types';

/** How often (ms) to refresh the dashboard summary. */
export const ORG_STATS_REFETCH_MS = 15_000;

/** Options controlling the org-stats query. */
export interface UseOrgStatsOptions {
  /** The organization whose stats to load. */
  orgId: string;
  /** When `false`, the query does not run. Defaults to `true`. */
  enabled?: boolean;
}

/**
 * Load today's queue statistics for an organization.
 *
 * @param options - the org plus enablement.
 * @returns The TanStack Query result holding {@link OrgStats}.
 */
export function useOrgStats(options: UseOrgStatsOptions): UseQueryResult<OrgStats, ApiError> {
  const { orgId, enabled = true } = options;

  return useQuery<OrgStats, ApiError>({
    queryKey: queryKeys.orgStats(orgId),
    queryFn: async ({ signal }) => {
      const { data } = await apiClient.get<OrgStats>(organizationEndpoints.stats(orgId), {
        signal,
      });
      return data;
    },
    enabled: enabled && Boolean(orgId),
    refetchInterval: ORG_STATS_REFETCH_MS,
  });
}
