/*
 * useServingMutation — shared optimistic-update wiring for the staff serving
 * actions (R6.10, R6.11, R6.12; design "Mutation + optimistic update flow").
 *
 * Every serving hook (call-next / recall / skip / complete / rejoin) follows the
 * same lifecycle against the single queue query key, so it lives here once:
 *
 *  - onMutate: `cancelQueries` on the queue key (so an in-flight refetch can't
 *    clobber the optimistic state), snapshot the previous cache via
 *    `getQueryData`, apply the action's optimistic patch with `setQueryData`,
 *    and return the snapshot in the mutation context (R6.10).
 *  - onError: roll the cache back to the snapshot and toast a message mapped
 *    from `error.code` — this is where `QUEUE_NO_WAITING` (R6.4) and
 *    `QUEUE_MAX_RECALL` (R6.6) surface their advice via `getErrorMessage`
 *    (R6.11).
 *  - onSettled: invalidate the queue key so the authoritative server state is
 *    refetched; the incoming `queue:update` socket event invalidates the SAME
 *    key, so REST success and realtime push converge on one reconcile (R6.12).
 *
 * The cache key patched/invalidated is `queryKeys.queue(orgId, scopeServiceId)`
 * — the exact key the panel's `useQueueStatus` query and the socket bridge use,
 * keeping all three in lockstep.
 */
import {
  useMutation,
  useQueryClient,
  type QueryKey,
  type UseMutationResult,
} from '@tanstack/react-query';
import { toast } from 'sonner';

import type { ApiError } from '@/lib/api/client';
import { getErrorMessage } from '@/lib/api/error-map';
import { queryKeys } from '@/lib/api/query-keys';

import type { QueueStatusResponse } from '../types';

/**
 * Context handed from `onMutate` to `onError`/`onSettled`: the cache snapshot to
 * restore on failure and the exact key it was taken from.
 */
export interface ServingMutationContext {
  /** The queue-status cache value before the optimistic patch (may be absent). */
  previous: QueueStatusResponse | undefined;
  /** The queue query key the snapshot/patch/invalidation operate on. */
  queueKey: QueryKey;
}

/** Configuration for {@link useServingMutation}. */
export interface ServingMutationConfig<TVariables, TData> {
  /** The organization the action targets. */
  orgId: string;
  /**
   * The serviceId the active queue-status query is scoped to. This selects the
   * cache key to patch/invalidate; it is usually the same value the Staff_Panel
   * passes to `useQueueStatus` (often `undefined` = the whole org).
   */
  scopeServiceId?: string;
  /** Performs the REST call and resolves the server result (or throws ApiError). */
  mutationFn: (variables: TVariables) => Promise<TData>;
  /**
   * Optional optimistic patch applied to the cached snapshot in `onMutate`.
   * Omitted for actions with no aggregate-visible optimistic change (recall).
   */
  patch?: (current: QueueStatusResponse, variables: TVariables) => QueueStatusResponse;
}

/**
 * Build a serving mutation with the shared snapshot → patch → rollback →
 * reconcile lifecycle. Named serving hooks are thin wrappers over this.
 *
 * @typeParam TVariables - the action's mutate variables.
 * @typeParam TData - the server result shape.
 * @param config - org/scope plus the action's `mutationFn` and optional `patch`.
 * @returns the configured TanStack mutation result.
 */
export function useServingMutation<TVariables, TData>(
  config: ServingMutationConfig<TVariables, TData>,
): UseMutationResult<TData, ApiError, TVariables, ServingMutationContext> {
  const { orgId, scopeServiceId, mutationFn, patch } = config;
  const queryClient = useQueryClient();
  const queueKey: QueryKey = queryKeys.queue(orgId, scopeServiceId);

  return useMutation<TData, ApiError, TVariables, ServingMutationContext>({
    mutationFn,
    onMutate: async (variables) => {
      // Stop any in-flight queue refetch so it can't overwrite the patch.
      await queryClient.cancelQueries({ queryKey: queueKey });

      const previous = queryClient.getQueryData<QueueStatusResponse>(queueKey);

      if (previous !== undefined && patch !== undefined) {
        queryClient.setQueryData<QueueStatusResponse>(queueKey, patch(previous, variables));
      }

      return { previous, queueKey };
    },
    onError: (error, _variables, context) => {
      // Roll back to the exact pre-mutation snapshot (R6.11).
      if (context !== undefined) {
        queryClient.setQueryData<QueueStatusResponse | undefined>(
          context.queueKey,
          context.previous,
        );
      }
      // Friendly, code-mapped copy — incl. QUEUE_NO_WAITING / QUEUE_MAX_RECALL.
      toast.error(getErrorMessage(error));
    },
    onSettled: (_data, _error, _variables, context) => {
      // Reconcile with the server; the socket queue:update hits the same key.
      void queryClient.invalidateQueries({ queryKey: context?.queueKey ?? queueKey });
    },
  });
}
