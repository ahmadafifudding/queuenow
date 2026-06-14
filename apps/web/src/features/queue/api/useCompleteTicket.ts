/*
 * useCompleteTicket — finish serving a CALLED/SERVING ticket (R6.8).
 *
 * Posts to the complete endpoint; the backend moves the ticket to COMPLETED.
 * The optimistic patch removes it from the service's `currentlyCalled` list,
 * decrements `serving`, and bumps `completedToday`, then reconciles via
 * invalidation + the `queue:update` socket event (R6.12). On failure the panel
 * rolls back and toasts a code-mapped message (R6.11).
 */
import type { UseMutationResult } from '@tanstack/react-query';
import type { IQueueTicket } from '@queuenow/shared-types';

import { type ApiError, apiClient } from '@/lib/api/client';

import { queueEndpoints } from './endpoints';
import { applyCompletePatch, type CalledTicketVars } from './serving-patches';
import { useServingMutation, type ServingMutationContext } from './useServingMutation';

/** Options for {@link useCompleteTicket}. */
export interface UseCompleteTicketOptions {
  /** The organization the queue belongs to. */
  orgId: string;
  /** The serviceId the panel's queue-status query is scoped to (cache key). */
  scopeServiceId?: string;
}

/** Variables passed to the complete mutation. */
export interface CompleteVariables extends CalledTicketVars {
  /** The CALLED/SERVING ticket to complete. */
  ticketId: string;
}

/**
 * Mutation hook for "complete". Optimistically clears the ticket from the active
 * list, bumps the completed count, and reconciles on success / socket update.
 *
 * @param options - the org and the active query scope.
 * @returns the configured TanStack mutation result.
 */
export function useCompleteTicket(
  options: UseCompleteTicketOptions,
): UseMutationResult<IQueueTicket, ApiError, CompleteVariables, ServingMutationContext> {
  const { orgId, scopeServiceId } = options;

  return useServingMutation<CompleteVariables, IQueueTicket>({
    orgId,
    scopeServiceId,
    mutationFn: async ({ ticketId }) => {
      const { data } = await apiClient.post<IQueueTicket>(queueEndpoints.complete(orgId, ticketId));
      return data;
    },
    patch: applyCompletePatch,
  });
}
