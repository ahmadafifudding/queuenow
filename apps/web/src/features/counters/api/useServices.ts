/*
 * useServices — list the organization's services so the counter form can pick
 * the service a counter is associated with (R9.1, R9.2).
 *
 * The counters feature needs service names both to render the "associated
 * service" column and to drive the form's service `<select>`. Rather than reach
 * into the (separately owned) services feature internals, this hook fetches the
 * list itself, keyed by the central `queryKeys.services(orgId)` so it shares the
 * cache with any other producer of that key.
 */
import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import type { IService } from '@queuenow/shared-types';

import { type ApiError, apiClient } from '@/lib/api/client';
import { queryKeys } from '@/lib/api/query-keys';

import { counterEndpoints } from './endpoints';

/** Options controlling the services list query. */
export interface UseServicesOptions {
  /** The organization whose services to load. */
  orgId: string;
  /** When `false`, the query does not run. Defaults to `true`. */
  enabled?: boolean;
}

/**
 * Load the organization's services (used to associate a counter with a service).
 *
 * @param options - the org plus enablement.
 * @returns the TanStack Query result holding the services list.
 */
export function useServices(options: UseServicesOptions): UseQueryResult<IService[], ApiError> {
  const { orgId, enabled = true } = options;

  return useQuery<IService[], ApiError>({
    queryKey: queryKeys.services(orgId),
    queryFn: async ({ signal }) => {
      const { data } = await apiClient.get<IService[]>(counterEndpoints.services(orgId), {
        signal,
      });
      return data;
    },
    enabled: enabled && Boolean(orgId),
  });
}
