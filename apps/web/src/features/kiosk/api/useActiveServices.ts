/*
 * useActiveServices — public, read-only list of the org's active services for
 * the Kiosk selection screen (R12.1, R12.2).
 *
 * Reads through the single API_Client and the CENTRAL services-style read off
 * the public queue-status aggregate (see `api/endpoints.ts`). The status
 * endpoint only returns ACTIVE services, so every entry here is selectable. No
 * auth, no mutations.
 */
import { useQuery, type UseQueryResult } from '@tanstack/react-query';

import { apiClient, type ApiError } from '@/lib/api/client';
import { queryKeys } from '@/lib/api/query-keys';

import type { KioskService } from '../types';
import { kioskEndpoints } from './endpoints';

/** Minimal shape consumed from the public queue-status response. */
interface QueueStatusResponse {
  services: Array<{
    service: { id: string; name: string; prefix: string };
  }>;
}

/**
 * Load the org's active services for the Kiosk.
 *
 * Uses the central `queryKeys.services(orgId)` key so it stays consistent with
 * the rest of the app's services reads/invalidation.
 *
 * @param orgId - the organization to take a ticket for.
 * @returns the TanStack Query result holding the selectable {@link KioskService}s.
 */
export function useActiveServices(orgId: string): UseQueryResult<KioskService[], ApiError> {
  return useQuery<KioskService[], ApiError>({
    queryKey: queryKeys.services(orgId),
    queryFn: async ({ signal }) => {
      const { data } = await apiClient.get<QueueStatusResponse>(
        kioskEndpoints.activeServices(orgId),
        { signal },
      );
      return data.services.map((entry) => ({
        id: entry.service.id,
        name: entry.service.name,
        prefix: entry.service.prefix,
      }));
    },
    enabled: Boolean(orgId),
  });
}
