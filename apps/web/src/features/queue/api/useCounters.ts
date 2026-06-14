/*
 * useCounters — minimal counters query for the queue panel's counter selector
 * (R6.2).
 *
 * The Staff_Panel must let a staff member pick an active counter before serving.
 * Full counters CRUD is Phase 2 (task 12); for now this hook just lists the
 * org's counters so the selector has something to drive it. It uses the central
 * `counters` query key so the Phase 2 mutation hooks can invalidate it later.
 */
import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import type { ICounter } from '@queuenow/shared-types';

import { type ApiError, apiClient } from '@/lib/api/client';
import { queryKeys } from '@/lib/api/query-keys';

import { queueEndpoints } from './endpoints';

/** Options controlling the counters query. */
export interface UseCountersOptions {
  /** The organization whose counters to load. */
  orgId: string;
  /**
   * When `false`, the query does not run (e.g. while `orgId` is unknown).
   * Defaults to `true`.
   */
  enabled?: boolean;
}

/**
 * Load the organization's counters.
 *
 * @param options - the org plus enablement.
 * @returns The TanStack Query result holding the counters list.
 */
export function useCounters(options: UseCountersOptions): UseQueryResult<ICounter[], ApiError> {
  const { orgId, enabled = true } = options;

  return useQuery<ICounter[], ApiError>({
    queryKey: queryKeys.counters(orgId),
    queryFn: async ({ signal }) => {
      const { data } = await apiClient.get<ICounter[]>(queueEndpoints.counters(orgId), {
        signal,
      });
      return data;
    },
    enabled: enabled && Boolean(orgId),
  });
}
