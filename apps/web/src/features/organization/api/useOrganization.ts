/*
 * useOrganization — load the organization's details + branding (R11.1–R11.3).
 *
 * Uses the central `queryKeys.org(orgId)` key so the update / branding mutation
 * hooks invalidate exactly this query on success. The response includes the
 * related `branding` record; the settings view reads `branding.primaryColor`
 * and applies it to the theme when the org loads (R11.3).
 */
import { useQuery, type UseQueryResult } from '@tanstack/react-query';

import { type ApiError, apiClient } from '@/lib/api/client';
import { queryKeys } from '@/lib/api/query-keys';

import type { OrganizationDetails } from '../types';
import { organizationEndpoints } from './endpoints';

/** Options controlling the organization-details query. */
export interface UseOrganizationOptions {
  /** The organization to load. */
  orgId: string;
  /** When `false`, the query does not run (e.g. while `orgId` is unknown). */
  enabled?: boolean;
}

/**
 * Load the organization's details (including branding).
 *
 * @param options - the org plus enablement.
 * @returns the TanStack Query result holding the organization details.
 */
export function useOrganization(
  options: UseOrganizationOptions,
): UseQueryResult<OrganizationDetails, ApiError> {
  const { orgId, enabled = true } = options;

  return useQuery<OrganizationDetails, ApiError>({
    queryKey: queryKeys.org(orgId),
    queryFn: async ({ signal }) => {
      const { data } = await apiClient.get<OrganizationDetails>(
        organizationEndpoints.details(orgId),
        { signal },
      );
      return data;
    },
    enabled: enabled && Boolean(orgId),
  });
}
