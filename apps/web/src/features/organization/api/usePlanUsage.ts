/*
 * usePlanUsage — load the org's plan + per-resource usage projection (R8.1–R8.3).
 *
 * Calls `GET /organizations/:id/plan-usage` through the single API_Client using
 * the central `queryKeys.planUsage(orgId)` key so `useChangePlan` invalidates
 * exactly this query on success. The response (`PlanUsageResponse` from
 * `@queuenow/shared-types`) carries the current `plan`, the boolean feature
 * `features` map (mirrors R9 gating), and the `resources` usage rows the Plan &
 * Usage view renders.
 *
 * The hook simply exposes the query result — including `isError` — so the
 * consuming view (task 14.x) can show an error indication with no usage values
 * on failure (R8.6). No special error handling is needed here.
 */
import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import type { PlanUsageResponse } from '@queuenow/shared-types';

import { type ApiError, apiClient } from '@/lib/api/client';
import { queryKeys } from '@/lib/api/query-keys';

import { organizationEndpoints } from './endpoints';

/** Options controlling the plan-usage query. */
export interface UsePlanUsageOptions {
  /** The organization whose plan + usage to load. */
  orgId: string;
  /** When `false`, the query does not run (e.g. while `orgId` is unknown). */
  enabled?: boolean;
}

/**
 * Load the org's plan + per-resource usage projection.
 *
 * @param options - the org plus enablement.
 * @returns the TanStack Query result holding the plan-usage projection.
 */
export function usePlanUsage(
  options: UsePlanUsageOptions,
): UseQueryResult<PlanUsageResponse, ApiError> {
  const { orgId, enabled = true } = options;

  return useQuery<PlanUsageResponse, ApiError>({
    queryKey: queryKeys.planUsage(orgId),
    queryFn: async ({ signal }) => {
      const { data } = await apiClient.get<PlanUsageResponse>(
        organizationEndpoints.planUsage(orgId),
        { signal },
      );
      return data;
    },
    enabled: enabled && Boolean(orgId),
  });
}
