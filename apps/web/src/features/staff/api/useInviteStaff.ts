/*
 * useInviteStaff — invite a staff member (R10.3, R10.4, R10.5).
 *
 * Posts an `inviteStaffSchema`-validated payload to the invite endpoint. The
 * form (`InviteStaffForm`) owns validation via the zod resolver and passes the
 * parsed `InviteStaffInput` here, so this hook deals only with the request and
 * the success/error contract:
 * - On success it invalidates the visible staff page (`['staff', orgId, page]`)
 *   through the shared `invalidateFeature` helper so the list reflects the new
 *   invitation (R10.4).
 * - On failure it surfaces the typed `ApiError`, whose `code`/`details` the form
 *   maps to a toast and inline field errors (R10.5).
 */
import { useMutation, useQueryClient, type UseMutationResult } from '@tanstack/react-query';
import type { InviteStaffInput } from '@queuenow/shared-validation';

import { apiClient, type ApiError } from '@/lib/api/client';
import { invalidateFeature } from '@/lib/api/invalidate-feature';

import type { StaffInvitation } from '../types';
import { staffEndpoints } from './endpoints';

/** Options for {@link useInviteStaff}. */
export interface UseInviteStaffOptions {
  /** The organization to invite into. */
  orgId: string;
  /** The currently-viewed page, used to invalidate `['staff', orgId, page]`. */
  page: number;
}

/**
 * Mutation hook for inviting a staff member.
 *
 * @param options - the org and the visible page (for invalidation).
 * @returns the configured TanStack mutation result.
 */
export function useInviteStaff(
  options: UseInviteStaffOptions,
): UseMutationResult<StaffInvitation, ApiError, InviteStaffInput> {
  const { orgId, page } = options;
  const queryClient = useQueryClient();

  return useMutation<StaffInvitation, ApiError, InviteStaffInput>({
    mutationFn: async (input) => {
      const { data } = await apiClient.post<StaffInvitation>(staffEndpoints.invite(orgId), input);
      return data;
    },
    onSuccess: async () => {
      await invalidateFeature(queryClient, { feature: 'staff', orgId, page });
    },
  });
}
