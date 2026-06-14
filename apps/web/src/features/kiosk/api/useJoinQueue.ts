/*
 * useJoinQueue — public join-queue mutation for the Kiosk (R12.4).
 *
 * Posts the validated `joinQueueSchema` payload to the public join endpoint and
 * returns the issued ticket (number + id for tracking). On success it
 * invalidates the central queue key so any open Display/queue views reflect the
 * new joiner. The caller inspects the thrown {@link ApiError} `.code` to handle
 * `QUEUE_FULL` distinctly (R12.6); all other failures map to a generic message.
 */
import { useMutation, useQueryClient, type UseMutationResult } from '@tanstack/react-query';
import type { JoinQueueInput } from '@queuenow/shared-validation';

import { apiClient, type ApiError } from '@/lib/api/client';
import { queryKeys } from '@/lib/api/query-keys';

import type { KioskJoinedTicket } from '../types';
import { kioskEndpoints } from './endpoints';

/** Subset of the join response the Kiosk renders. */
interface JoinQueueResponse {
  id: string;
  ticketNumber: string;
  position?: number | null;
  estimatedWaitMinutes?: number | null;
}

/**
 * Create the join-queue mutation for an organization.
 *
 * @param orgId - the organization to join.
 * @returns a TanStack mutation issuing a ticket and yielding {@link KioskJoinedTicket}.
 */
export function useJoinQueue(
  orgId: string,
): UseMutationResult<KioskJoinedTicket, ApiError, JoinQueueInput> {
  const queryClient = useQueryClient();

  return useMutation<KioskJoinedTicket, ApiError, JoinQueueInput>({
    mutationFn: async (input) => {
      const { data } = await apiClient.post<JoinQueueResponse>(kioskEndpoints.join(orgId), input);
      return {
        id: data.id,
        ticketNumber: data.ticketNumber,
        position: data.position,
        estimatedWaitMinutes: data.estimatedWaitMinutes,
      };
    },
    onSuccess: () => {
      // A new joiner changes queue state; refresh any live queue reads (R12.4).
      void queryClient.invalidateQueries({ queryKey: queryKeys.queue(orgId) });
    },
  });
}
