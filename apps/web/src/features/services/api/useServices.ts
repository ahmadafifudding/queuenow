/*
 * useServices — TanStack Query hook listing the org's services (R8.1).
 *
 * Reads the org's services through the single API_Client and the central
 * `services` query key, so the create/update/toggle mutation hooks can
 * invalidate the exact same key to refresh the list (R8.5). Feature code never
 * calls `fetch` directly — all server interaction flows through this colocated
 * hook (steering "API Layer", R2.1).
 */
import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import type { IService } from '@queuenow/shared-types';

import { apiClient, type ApiError } from '@/lib/api/client';
import { queryKeys } from '@/lib/api/query-keys';

import { serviceEndpoints } from './endpoints';

/** Options controlling the services query. */
export interface UseServicesOptions {
  /** The organization whose services to load. */
  orgId: string;
  /**
   * When `false`, the query does not run (e.g. while `orgId` is unknown).
   * Defaults to `true`.
   */
  enabled?: boolean;
}

/**
 * Load the organization's services.
 *
 * @param options - the org plus enablement.
 * @returns The TanStack Query result holding the services list.
 */
export function useServices(options: UseServicesOptions): UseQueryResult<IService[], ApiError> {
  const { orgId, enabled = true } = options;

  return useQuery<IService[], ApiError>({
    queryKey: queryKeys.services(orgId),
    queryFn: async ({ signal }) => {
      const { data } = await apiClient.get<IService[]>(serviceEndpoints.list(orgId), { signal });
      return data;
    },
    enabled: enabled && Boolean(orgId),
  });
}
