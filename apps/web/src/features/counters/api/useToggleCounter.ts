/*
 * useToggleCounter — flip a counter's active state (R9.4, R9.5).
 *
 * There is no dedicated toggle endpoint, so this patches the counter with just
 * `{ isActive }` through the same update route, then invalidates
 * `['counters', orgId]` so the list reflects the new state (R9.4, R9.5).
 * Failures surface as a typed `ApiError`; the list maps the code to friendly
 * copy via a toast (R9.6).
 */
import { useMutation, useQueryClient, type UseMutationResult } from '@tanstack/react-query';
import type { ICounter } from '@queuenow/shared-types';

import { type ApiError, apiClient } from '@/lib/api/client';
import { invalidateFeature } from '@/lib/api/invalidate-feature';

import { counterEndpoints } from './endpoints';

/** Options for {@link useToggleCounter}. */
export interface UseToggleCounterOptions {
  /** The organization the counter belongs to. */
  orgId: string;
}

/** Variables for the toggle mutation: which counter, and the next active state. */
export interface ToggleCounterVariables {
  /** The counter to toggle. */
  id: string;
  /** The next active state to persist. */
  isActive: boolean;
}

/**
 * Mutation hook for toggling a counter's active state (a thin `isActive`-only
 * PATCH over the update endpoint).
 *
 * @param options - the target org.
 * @returns the configured TanStack mutation result.
 */
export function useToggleCounter(
  options: UseToggleCounterOptions,
): UseMutationResult<ICounter, ApiError, ToggleCounterVariables> {
  const { orgId } = options;
  const queryClient = useQueryClient();

  return useMutation<ICounter, ApiError, ToggleCounterVariables>({
    mutationFn: async ({ id, isActive }) => {
      const { data } = await apiClient.patch<ICounter>(counterEndpoints.update(orgId, id), {
        isActive,
      });
      return data;
    },
    onSuccess: async () => {
      await invalidateFeature(queryClient, { feature: 'counters', orgId });
    },
  });
}
