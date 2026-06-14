/*
 * useQueueSettings — load the org's queue settings (R11.6).
 *
 * Settings have their own endpoint (`GET /organizations/:id/settings`) and so
 * their own query key, derived from the central org key as
 * `['organization', orgId, 'settings']`. Deriving it from `queryKeys.org` keeps
 * it scoped to the org without widening the shared key factory.
 */
import { useQuery, type UseQueryResult } from '@tanstack/react-query';

import { type ApiError, apiClient } from '@/lib/api/client';
import { queryKeys } from '@/lib/api/query-keys';

import type { QueueSettings } from '../types';
import { organizationEndpoints } from './endpoints';

/** The settings sub-key derived from the central org key. */
export function queueSettingsKey(
  orgId: string,
): readonly [...ReturnType<typeof queryKeys.org>, 'settings'] {
  return [...queryKeys.org(orgId), 'settings'] as const;
}

/** Options controlling the queue-settings query. */
export interface UseQueueSettingsOptions {
  /** The organization whose settings to load. */
  orgId: string;
  /** When `false`, the query does not run (e.g. while `orgId` is unknown). */
  enabled?: boolean;
}

/**
 * Load the organization's queue settings.
 *
 * @param options - the org plus enablement.
 * @returns the TanStack Query result holding the queue settings.
 */
export function useQueueSettings(
  options: UseQueueSettingsOptions,
): UseQueryResult<QueueSettings, ApiError> {
  const { orgId, enabled = true } = options;

  return useQuery<QueueSettings, ApiError>({
    queryKey: queueSettingsKey(orgId),
    queryFn: async ({ signal }) => {
      const { data } = await apiClient.get<QueueSettings>(organizationEndpoints.settings(orgId), {
        signal,
      });
      return data;
    },
    enabled: enabled && Boolean(orgId),
  });
}
