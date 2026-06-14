/*
 * useUpdateService — edit an existing service (R8.3, R8.5).
 *
 * Validates the input with the shared `updateServiceSchema` (a `.partial()` of
 * `createServiceSchema`) from `@queuenow/shared-validation`, PATCHes it through
 * the single API_Client at `/organizations/:orgId/services/:id`, and on success
 * invalidates the org's `['services', orgId]` query key so the list reflects the
 * new state (R8.5).
 *
 * Failures throw the typed `ApiError`; the calling form maps `error.details`
 * onto fields and `error.code` onto a toast (R8.6).
 */
import { useMutation, useQueryClient, type UseMutationResult } from '@tanstack/react-query';
import type { IService } from '@queuenow/shared-types';
import { updateServiceSchema, type UpdateServiceInput } from '@queuenow/shared-validation';

import { apiClient, type ApiError } from '@/lib/api/client';
import { invalidateFeature } from '@/lib/api/invalidate-feature';

import { serviceEndpoints } from './endpoints';

/** Options for {@link useUpdateService}. */
export interface UseUpdateServiceOptions {
  /** The organization the service belongs to. */
  orgId: string;
}

/** Variables passed to the update mutation: which service plus the changed fields. */
export interface UpdateServiceVariables {
  /** The id of the service to update. */
  id: string;
  /** The (partial) fields to change, validated by `updateServiceSchema`. */
  input: UpdateServiceInput;
}

/**
 * Mutation hook for editing a service. Validates with `updateServiceSchema`
 * before calling the update endpoint and invalidates the services list on
 * success.
 *
 * @param options - the target org.
 * @returns the configured TanStack mutation result.
 */
export function useUpdateService(
  options: UseUpdateServiceOptions,
): UseMutationResult<IService, ApiError, UpdateServiceVariables> {
  const { orgId } = options;
  const queryClient = useQueryClient();

  return useMutation<IService, ApiError, UpdateServiceVariables>({
    mutationFn: async ({ id, input }) => {
      // Validate with the shared schema at the API boundary (R8.3).
      const payload = updateServiceSchema.parse(input);
      const { data } = await apiClient.patch<IService>(serviceEndpoints.detail(orgId, id), payload);
      return data;
    },
    onSuccess: () => invalidateFeature(queryClient, { feature: 'services', orgId }),
  });
}
