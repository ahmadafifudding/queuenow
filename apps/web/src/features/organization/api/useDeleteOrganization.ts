/*
 * useDeleteOrganization — delete the organization (R11.7, OWNER only).
 *
 * Calls `DELETE /organizations/:id`. Visibility/gating is enforced in the UI via
 * `<RoleGate roles={[OWNER]}>` / the `delete-organization` capability; the
 * backend remains the security boundary.
 *
 * ASSUMPTION (documented in `endpoints.ts`): the backend controller does not yet
 * expose this route. The hook is intentionally minimal so the OWNER-gated
 * control is wired correctly today and the call works once the endpoint ships.
 */
import { useMutation, useQueryClient, type UseMutationResult } from '@tanstack/react-query';

import { type ApiError, apiClient } from '@/lib/api/client';
import { queryKeys } from '@/lib/api/query-keys';

import { organizationEndpoints } from './endpoints';

/** Delete-organization mutation (OWNER only). Invalidates the org key on success. */
export function useDeleteOrganization(orgId: string): UseMutationResult<void, ApiError, void> {
  const queryClient = useQueryClient();

  return useMutation<void, ApiError, void>({
    mutationFn: async () => {
      await apiClient.delete<unknown>(organizationEndpoints.delete(orgId));
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.org(orgId) });
    },
  });
}
