/*
 * useSkipTicket — skip a CALLED ticket (R6.7).
 *
 * Posts to the skip endpoint; the backend moves the ticket to SKIPPED. The
 * optimistic patch removes the ticket from the service's `currentlyCalled`
 * (active serving) list so it disappears immediately, then reconciles via
 * invalidation + the `queue:update` socket event (R6.12). On failure the panel
 * rolls back and toasts a code-mapped message (R6.11).
 */
import type { UseMutationResult } from '@tanstack/react-query';
import type { IQueueTicket } from '@queuenow/shared-types';

import { type ApiError, apiClient } from '@/lib/api/client';

import { queueEndpoints } from './endpoints';
import { applySkipPatch, type CalledTicketVars } from './serving-patches';
import { useServingMutation, type ServingMutationContext } from './useServingMutation';

/** Options for {@link useSkipTicket}. */
export interface UseSkipTicketOptions {
  /** The organization the queue belongs to. */
  orgId: string;
  /** The serviceId the panel's queue-status query is scoped to (cache key). */
  scopeServiceId?: string;
}

/** Variables passed to the skip mutation. */
export interface SkipVariables extends CalledTicketVars {
  /** The CALLED ticket to skip. */
  ticketId: string;
}

/**
 * Mutation hook for "skip". Optimistically removes the ticket from the active
 * serving list and reconciles on success / socket update.
 *
 * @param options - the org and the active query scope.
 * @returns the configured TanStack mutation result.
 */
export function useSkipTicket(
  options: UseSkipTicketOptions,
): UseMutationResult<IQueueTicket, ApiError, SkipVariables, ServingMutationContext> {
  const { orgId, scopeServiceId } = options;

  return useServingMutation<SkipVariables, IQueueTicket>({
    orgId,
    scopeServiceId,
    mutationFn: async ({ ticketId }) => {
      const { data } = await apiClient.post<IQueueTicket>(queueEndpoints.skip(orgId, ticketId));
      return data;
    },
    patch: applySkipPatch,
  });
}
