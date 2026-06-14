/*
 * useUpdateOrganization — update org details (R11.1).
 *
 * Calls `PATCH /organizations/:id` through the single API_Client and invalidates
 * the central org query key on success so the details view reflects the saved
 * data. Throws a typed `ApiError` on failure so the form can map `error.details`
 * onto fields and `error.code` onto a toast (R11.8).
 */
import { useMutation, useQueryClient, type UseMutationResult } from '@tanstack/react-query';
import type { UpdateOrganizationInput } from '@queuenow/shared-validation';

import { type ApiError, apiClient } from '@/lib/api/client';
import { queryKeys } from '@/lib/api/query-keys';

import type { OrganizationDetails } from '../types';
import { organizationEndpoints } from './endpoints';

/** Update-organization mutation. Invalidates the org query key on success. */
export function useUpdateOrganization(
  orgId: string,
): UseMutationResult<OrganizationDetails, ApiError, UpdateOrganizationInput> {
  const queryClient = useQueryClient();

  return useMutation<OrganizationDetails, ApiError, UpdateOrganizationInput>({
    mutationFn: async (input) => {
      const { data } = await apiClient.patch<OrganizationDetails>(
        organizationEndpoints.update(orgId),
        input,
      );
      return data;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.org(orgId) });
    },
  });
}
