/*
 * useCreateService — create a new service (R8.2, R8.5).
 *
 * Validates the input with the shared `createServiceSchema` from
 * `@queuenow/shared-validation` (never redefined on the client), POSTs it
 * through the single API_Client, and on success invalidates the org's
 * `['services', orgId]` query key via the shared `invalidateFeature` helper so
 * the list reflects current data (R8.5).
 *
 * Failures throw the typed `ApiError`; the calling form maps `error.details`
 * onto fields and `error.code` onto a toast (R8.6).
 */
import { useMutation, useQueryClient, type UseMutationResult } from '@tanstack/react-query';
import type { IService } from '@queuenow/shared-types';
import { createServiceSchema, type CreateServiceInput } from '@queuenow/shared-validation';

import { apiClient, type ApiError } from '@/lib/api/client';
import { invalidateFeature } from '@/lib/api/invalidate-feature';

import { serviceEndpoints } from './endpoints';

/** Options for {@link useCreateService}. */
export interface UseCreateServiceOptions {
  /** The organization the new service belongs to. */
  orgId: string;
}

/**
 * Mutation hook for creating a service. Validates with `createServiceSchema`
 * before calling the create endpoint and invalidates the services list on
 * success.
 *
 * @param options - the target org.
 * @returns the configured TanStack mutation result.
 */
export function useCreateService(
  options: UseCreateServiceOptions,
): UseMutationResult<IService, ApiError, CreateServiceInput> {
  const { orgId } = options;
  const queryClient = useQueryClient();

  return useMutation<IService, ApiError, CreateServiceInput>({
    mutationFn: async (input) => {
      // Validate with the shared schema at the API boundary (R8.2).
      const payload = createServiceSchema.parse(input);
      const { data } = await apiClient.post<IService>(serviceEndpoints.list(orgId), payload);
      return data;
    },
    onSuccess: () => invalidateFeature(queryClient, { feature: 'services', orgId }),
  });
}
