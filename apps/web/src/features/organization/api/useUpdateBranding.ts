/*
 * useUpdateBranding — update org branding (R11.2, R11.3).
 *
 * Calls `PATCH /organizations/:id/branding`. On success it invalidates the org
 * query key (so the loaded branding refreshes) and re-applies the saved
 * `primaryColor` to the `--primary` CSS variable immediately via `applyBranding`
 * so the change is visible without waiting for a refetch (R11.3). Throws a typed
 * `ApiError` so the form maps field errors + an error-code toast (R11.8).
 */
import { useMutation, useQueryClient, type UseMutationResult } from '@tanstack/react-query';
import type { UpdateBrandingInput } from '@queuenow/shared-validation';

import { type ApiError, apiClient } from '@/lib/api/client';
import { queryKeys } from '@/lib/api/query-keys';
import { applyBranding } from '@/lib/theme';

import type { OrganizationBranding } from '../types';
import { organizationEndpoints } from './endpoints';

/** Update-branding mutation. Invalidates the org key and re-applies branding. */
export function useUpdateBranding(
  orgId: string,
): UseMutationResult<OrganizationBranding, ApiError, UpdateBrandingInput> {
  const queryClient = useQueryClient();

  return useMutation<OrganizationBranding, ApiError, UpdateBrandingInput>({
    mutationFn: async (input) => {
      const { data } = await apiClient.patch<OrganizationBranding>(
        organizationEndpoints.branding(orgId),
        input,
      );
      return data;
    },
    onSuccess: (branding) => {
      // Reflect the new brand color at runtime right away (R11.3, R11.4).
      if (branding.primaryColor) {
        applyBranding(branding.primaryColor);
      }
      void queryClient.invalidateQueries({ queryKey: queryKeys.org(orgId) });
    },
  });
}
