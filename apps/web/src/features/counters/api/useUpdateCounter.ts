/*
 * useUpdateCounter — edit a counter (R9.3, R9.5).
 *
 * Patches an `updateCounterSchema`-validated (partial) body to the
 * update-counter endpoint and, on success, invalidates `['counters', orgId]` so
 * the management list reflects the edit (R9.5). Failures surface as a typed
 * `ApiError` for the form to map to friendly copy (R9.6).
 */
import { useMutation, useQueryClient, type UseMutationResult } from '@tanstack/react-query';
import type { ICounter } from '@queuenow/shared-types';
import type { UpdateCounterInput } from '@queuenow/shared-validation';

import { type ApiError, apiClient } from '@/lib/api/client';
import { invalidateFeature } from '@/lib/api/invalidate-feature';

import { counterEndpoints } from './endpoints';

/** Options for {@link useUpdateCounter}. */
export interface UseUpdateCounterOptions {
  /** The organization the counter belongs to. */
  orgId: string;
}

/** Variables for the update mutation: which counter, and the fields to change. */
export interface UpdateCounterVariables {
  /** The counter to update. */
  id: string;
  /** The partial set of fields to change. */
  input: UpdateCounterInput;
}

/**
 * Mutation hook for editing a counter.
 *
 * @param options - the target org.
 * @returns the configured TanStack mutation result.
 */
export function useUpdateCounter(
  options: UseUpdateCounterOptions,
): UseMutationResult<ICounter, ApiError, UpdateCounterVariables> {
  const { orgId } = options;
  const queryClient = useQueryClient();

  return useMutation<ICounter, ApiError, UpdateCounterVariables>({
    mutationFn: async ({ id, input }) => {
      const { data } = await apiClient.patch<ICounter>(counterEndpoints.update(orgId, id), input);
      return data;
    },
    onSuccess: async () => {
      await invalidateFeature(queryClient, { feature: 'counters', orgId });
    },
  });
}
