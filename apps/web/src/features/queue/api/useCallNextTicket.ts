/*
 * useCallNextTicket — call the next WAITING customer for a counter (R6.3, R6.4).
 *
 * Posts the selected `counterId` to the call-next endpoint; the backend pulls
 * the oldest WAITING ticket for that counter's service and moves it to CALLED.
 * The optimistic patch decrements that service's `waiting` count so the panel
 * reacts instantly, then reconciles via invalidation + the `queue:update` socket
 * event (R6.12). When no one is waiting the backend rejects with
 * `QUEUE_NO_WAITING`, which the shared error path surfaces as the "queue is
 * empty" message (R6.4).
 */
import type { UseMutationResult } from '@tanstack/react-query';
import type { IQueueTicket } from '@queuenow/shared-types';

import { type ApiError, apiClient } from '@/lib/api/client';

import { queueEndpoints } from './endpoints';
import { applyCallNextPatch, type ServiceScopedVars } from './serving-patches';
import { useServingMutation, type ServingMutationContext } from './useServingMutation';

/** Options for {@link useCallNextTicket}. */
export interface UseCallNextTicketOptions {
  /** The organization the queue belongs to. */
  orgId: string;
  /** The serviceId the panel's queue-status query is scoped to (cache key). */
  scopeServiceId?: string;
}

/** Variables passed to the call-next mutation. */
export interface CallNextVariables extends ServiceScopedVars {
  /** The counter to call the next customer from (R6.2). */
  counterId: string;
}

/**
 * Mutation hook for "call next". Optimistically decrements the waiting count for
 * the counter's service and reconciles on success / socket update.
 *
 * @param options - the org and the active query scope.
 * @returns the configured TanStack mutation result.
 */
export function useCallNextTicket(
  options: UseCallNextTicketOptions,
): UseMutationResult<IQueueTicket, ApiError, CallNextVariables, ServingMutationContext> {
  const { orgId, scopeServiceId } = options;

  return useServingMutation<CallNextVariables, IQueueTicket>({
    orgId,
    scopeServiceId,
    mutationFn: async ({ counterId }) => {
      const { data } = await apiClient.post<IQueueTicket>(queueEndpoints.callNext(orgId), {
        counterId,
      });
      return data;
    },
    patch: applyCallNextPatch,
  });
}
