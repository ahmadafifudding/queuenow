/*
 * useRecallTicket — re-announce a CALLED ticket (R6.5, R6.6).
 *
 * Posts to the recall endpoint; the backend bumps the ticket's recall count up
 * to the org's `maxRecall`. The aggregate queue snapshot does not surface a
 * per-ticket recall count, so there is no aggregate-visible optimistic patch —
 * the updated count (R6.5) is reflected by the post-success invalidation and the
 * `queue:update` socket reconcile (R6.12). The hook still snapshots and rolls
 * back like its siblings for safety. When the recall limit is hit the backend
 * rejects with `QUEUE_MAX_RECALL`, surfaced as the "skip the ticket" advice via
 * the shared error path (R6.6, R6.11).
 */
import type { UseMutationResult } from '@tanstack/react-query';
import type { IQueueTicket } from '@queuenow/shared-types';

import { type ApiError, apiClient } from '@/lib/api/client';

import { queueEndpoints } from './endpoints';
import type { ServiceScopedVars } from './serving-patches';
import { useServingMutation, type ServingMutationContext } from './useServingMutation';

/** Options for {@link useRecallTicket}. */
export interface UseRecallTicketOptions {
  /** The organization the queue belongs to. */
  orgId: string;
  /** The serviceId the panel's queue-status query is scoped to (cache key). */
  scopeServiceId?: string;
}

/** Variables passed to the recall mutation. */
export interface RecallVariables extends ServiceScopedVars {
  /** The CALLED ticket to recall. */
  ticketId: string;
}

/**
 * Mutation hook for "recall". No aggregate-visible optimistic patch; reconciles
 * the recall count via invalidation / socket update.
 *
 * @param options - the org and the active query scope.
 * @returns the configured TanStack mutation result.
 */
export function useRecallTicket(
  options: UseRecallTicketOptions,
): UseMutationResult<IQueueTicket, ApiError, RecallVariables, ServingMutationContext> {
  const { orgId, scopeServiceId } = options;

  return useServingMutation<RecallVariables, IQueueTicket>({
    orgId,
    scopeServiceId,
    mutationFn: async ({ ticketId }) => {
      const { data } = await apiClient.post<IQueueTicket>(queueEndpoints.recall(orgId, ticketId));
      return data;
    },
  });
}
