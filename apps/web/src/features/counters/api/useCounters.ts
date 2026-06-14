/*
 * useCounters — list the organization's counters for the management UI (R9.1).
 *
 * This is the counters MANAGEMENT query (Phase 2, task 12.1). It is intentionally
 * separate from `features/queue/api/useCounters.ts` (which feeds the staff
 * counter selector) but uses the SAME central query key —
 * `queryKeys.counters(orgId)` — so the create/update/toggle mutation hooks here
 * invalidate one key and both surfaces stay current (R9.5).
 */
import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import type { ICounter } from '@queuenow/shared-types';

import { type ApiError, apiClient } from '@/lib/api/client';
import { queryKeys } from '@/lib/api/query-keys';

import { counterEndpoints } from './endpoints';

/** Options controlling the counters list query. */
export interface UseCountersOptions {
  /** The organization whose counters to load. */
  orgId: string;
  /** When `false`, the query does not run (e.g. while `orgId` is unknown). Defaults to `true`. */
  enabled?: boolean;
}

/**
 * Load the organization's counters for the management list.
 *
 * @param options - the org plus enablement.
 * @returns the TanStack Query result holding the counters list.
 */
export function useCounters(options: UseCountersOptions): UseQueryResult<ICounter[], ApiError> {
  const { orgId, enabled = true } = options;

  return useQuery<ICounter[], ApiError>({
    queryKey: queryKeys.counters(orgId),
    queryFn: async ({ signal }) => {
      const { data } = await apiClient.get<ICounter[]>(counterEndpoints.list(orgId), { signal });
      return data;
    },
    enabled: enabled && Boolean(orgId),
  });
}
