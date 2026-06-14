/*
 * useToggleService — flip a service's active state (R8.4, R8.5).
 *
 * Toggling active is just an update of the `isActive` field, so it goes through
 * the same `PATCH /organizations/:orgId/services/:id` endpoint, validated with
 * the shared `updateServiceSchema`, and invalidates the org's
 * `['services', orgId]` query key on success so the list reflects the new state
 * (R8.5). It is exposed as its own intent-named hook (per steering "name
 * query/mutation hooks by intent") so the list's toggle control reads clearly.
 *
 * Failures throw the typed `ApiError`; the caller toasts a message mapped from
 * `error.code` (R8.6).
 */
import { useMutation, useQueryClient, type UseMutationResult } from '@tanstack/react-query';
import type { IService } from '@queuenow/shared-types';
import { updateServiceSchema } from '@queuenow/shared-validation';

import { apiClient, type ApiError } from '@/lib/api/client';
import { invalidateFeature } from '@/lib/api/invalidate-feature';

import { serviceEndpoints } from './endpoints';

/** Options for {@link useToggleService}. */
export interface UseToggleServiceOptions {
  /** The organization the service belongs to. */
  orgId: string;
}

/** Variables passed to the toggle mutation. */
export interface ToggleServiceVariables {
  /** The id of the service to toggle. */
  id: string;
  /** The desired active state. */
  isActive: boolean;
}

/**
 * Mutation hook for toggling a service's active state. Validates the partial
 * `{ isActive }` payload with `updateServiceSchema` and invalidates the services
 * list on success.
 *
 * @param options - the target org.
 * @returns the configured TanStack mutation result.
 */
export function useToggleService(
  options: UseToggleServiceOptions,
): UseMutationResult<IService, ApiError, ToggleServiceVariables> {
  const { orgId } = options;
  const queryClient = useQueryClient();

  return useMutation<IService, ApiError, ToggleServiceVariables>({
    mutationFn: async ({ id, isActive }) => {
      const payload = updateServiceSchema.parse({ isActive });
      const { data } = await apiClient.patch<IService>(serviceEndpoints.detail(orgId, id), payload);
      return data;
    },
    onSuccess: () => invalidateFeature(queryClient, { feature: 'services', orgId }),
  });
}
