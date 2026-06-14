/*
 * useRejoinTicket — return a SKIPPED ticket to the queue (R6.9).
 *
 * Posts to the rejoin endpoint; the backend resets the ticket to WAITING at the
 * end of the queue and returns its new `position`. The optimistic patch
 * increments the service's `waiting` count so the panel reacts instantly, then
 * reconciles via invalidation + the `queue:update` socket event (R6.12). On
 * failure the panel rolls back and toasts a code-mapped message (R6.11).
 */
import type { UseMutationResult } from '@tanstack/react-query';
import type { IQueueTicket } from '@queuenow/shared-types';

import { type ApiError, apiClient } from '@/lib/api/client';

import { queueEndpoints } from './endpoints';
import { applyRejoinPatch, type ServiceScopedVars } from './serving-patches';
import { useServingMutation, type ServingMutationContext } from './useServingMutation';

/** The rejoin result: the updated ticket plus its new waiting position. */
export type RejoinResult = IQueueTicket & { position: number };

/** Options for {@link useRejoinTicket}. */
export interface UseRejoinTicketOptions {
  /** The organization the queue belongs to. */
  orgId: string;
  /** The serviceId the panel's queue-status query is scoped to (cache key). */
  scopeServiceId?: string;
}

/** Variables passed to the rejoin mutation. */
export interface RejoinVariables extends ServiceScopedVars {
  /** The SKIPPED ticket to return to WAITING. */
  ticketId: string;
}

/**
 * Mutation hook for "rejoin". Optimistically increments the waiting count and
 * reconciles on success / socket update.
 *
 * @param options - the org and the active query scope.
 * @returns the configured TanStack mutation result.
 */
export function useRejoinTicket(
  options: UseRejoinTicketOptions,
): UseMutationResult<RejoinResult, ApiError, RejoinVariables, ServingMutationContext> {
  const { orgId, scopeServiceId } = options;

  return useServingMutation<RejoinVariables, RejoinResult>({
    orgId,
    scopeServiceId,
    mutationFn: async ({ ticketId }) => {
      const { data } = await apiClient.post<RejoinResult>(queueEndpoints.rejoin(orgId, ticketId));
      return data;
    },
    patch: applyRejoinPatch,
  });
}
