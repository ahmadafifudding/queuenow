/*
 * useCreateCounter — create a counter (R9.2, R9.5).
 *
 * Posts a `createCounterSchema`-validated body to the create-counter endpoint
 * and, on success, invalidates `['counters', orgId]` via the shared
 * `invalidateFeature` helper so the management list reflects the new counter
 * (R9.5). Failures surface as a typed `ApiError`; the calling form maps the
 * error code to friendly copy (R9.6).
 */
import { useMutation, useQueryClient, type UseMutationResult } from '@tanstack/react-query';
import type { ICounter } from '@queuenow/shared-types';
import type { CreateCounterInput } from '@queuenow/shared-validation';

import { type ApiError, apiClient } from '@/lib/api/client';
import { invalidateFeature } from '@/lib/api/invalidate-feature';

import { counterEndpoints } from './endpoints';

/** Options for {@link useCreateCounter}. */
export interface UseCreateCounterOptions {
  /** The organization the counter belongs to. */
  orgId: string;
}

/**
 * Mutation hook for creating a counter.
 *
 * @param options - the target org.
 * @returns the configured TanStack mutation result.
 */
export function useCreateCounter(
  options: UseCreateCounterOptions,
): UseMutationResult<ICounter, ApiError, CreateCounterInput> {
  const { orgId } = options;
  const queryClient = useQueryClient();

  return useMutation<ICounter, ApiError, CreateCounterInput>({
    mutationFn: async (input) => {
      const { data } = await apiClient.post<ICounter>(counterEndpoints.create(orgId), input);
      return data;
    },
    onSuccess: async () => {
      await invalidateFeature(queryClient, { feature: 'counters', orgId });
    },
  });
}
