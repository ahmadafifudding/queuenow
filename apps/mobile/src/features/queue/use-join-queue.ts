/**
 * Join-queue mutation hook (R2.1, R2.4, R2.5, R2.6, R2.7).
 *
 * {@link useJoinQueue} drives the `POST /organizations/:orgId/queue/join` call
 * through the single shared `apiClient`. It resolves the stable anonymous
 * `deviceFingerprint` (R2.3) and the signed-in `customerProfileId` (R2.6) from
 * the Auth_Manager / auth-store, then hands construction + validation to the
 * PURE {@link buildJoinRequest} — so invalid input never reaches the network
 * (R2.7). On success it invalidates the org's queue status so counts/wait
 * estimates reflect the new ticket (design invalidation rule).
 *
 * QUEUE_FULL handling (R2.5): a `QUEUE_FULL` rejection surfaces as the mutation
 * `error` (an `ApiError`) and yields NO `data`, so the screen shows the mapped
 * queue-full copy and issues/displays no ticket. {@link isQueueFullError} is the
 * code-keyed predicate the screen uses (never matching on message text, R10.4).
 *
 * Boundaries (`apiClient`, `authManager`, `authStore`) are injectable via
 * {@link UseJoinQueueDeps} so the flow can be tested without a live backend.
 */
import { ERROR_CODES } from '@queuenow/shared-constants';
import { useMutation, useQueryClient, type UseMutationResult } from '@tanstack/react-query';

import { ApiError, apiClient as defaultApiClient, type ApiClient } from '@/lib/api/client';
import { invalidateOrgStatusOnJoin } from '@/lib/api/invalidation';
import { authManager as defaultAuthManager, type AuthManager } from '@/lib/auth/auth-manager';
import { authStore as defaultAuthStore } from '@/lib/auth/auth-store';

import { buildJoinRequest } from './build-join-request';
import type { JoinedTicket, JoinQueueVariables } from './types';

/** The minimal auth-store surface the hook reads (the signed-in profile id). */
interface AuthStoreLike {
  getState(): { customer: { id: string } | null };
}

/** Injectable boundaries for {@link useJoinQueue}; all optional with real defaults. */
export interface UseJoinQueueDeps {
  /** REST client used to POST the join. Defaults to the shared {@link apiClient}. */
  apiClient?: ApiClient;
  /** Auth manager for fingerprint + signed-in status. Defaults to the shared one. */
  authManager?: AuthManager;
  /** In-memory session mirror for the customer profile id. Defaults to the shared one. */
  authStore?: AuthStoreLike;
}

/**
 * Code-keyed predicate: `true` when the error is a `QUEUE_FULL` rejection (R2.5).
 * Keyed only on the `ApiError.code`, never on message text (R10.4).
 */
export function isQueueFullError(error: unknown): boolean {
  return error instanceof ApiError && error.code === ERROR_CODES.QUEUE_FULL;
}

/**
 * Build the join-queue mutation for an organization. The mutation variables
 * carry the selected service and the optional contact fields; the fingerprint
 * and signed-in profile id are resolved internally at submit time.
 *
 * @param orgId The organization id the join is scoped to.
 * @param deps Optional injected boundaries (for tests).
 * @returns The TanStack mutation result; `data` is the joined ticket on success.
 */
export function useJoinQueue(
  orgId: string,
  deps: UseJoinQueueDeps = {},
): UseMutationResult<JoinedTicket, ApiError, JoinQueueVariables> {
  const api = deps.apiClient ?? defaultApiClient;
  const auth = deps.authManager ?? defaultAuthManager;
  const store = deps.authStore ?? defaultAuthStore;
  const queryClient = useQueryClient();

  return useMutation<JoinedTicket, ApiError, JoinQueueVariables>({
    mutationFn: async (variables): Promise<JoinedTicket> => {
      const deviceFingerprint = await auth.getDeviceFingerprint();
      const isSignedIn = auth.isSignedIn();
      const customerProfileId = isSignedIn ? (store.getState().customer?.id ?? null) : null;

      const built = buildJoinRequest({
        orgId,
        serviceId: variables.serviceId,
        deviceFingerprint,
        customerName: variables.customerName,
        customerPhone: variables.customerPhone,
        isSignedIn,
        customerProfileId,
      });

      // R2.7 — invalid input never reaches the network.
      if (!built.valid) {
        throw new ApiError(
          ERROR_CODES.VALIDATION_ERROR,
          'Please check your details and try again.',
          { issues: built.issues },
        );
      }

      const { data } = await api.post<JoinedTicket>(built.path, built.body);
      return data;
    },
    onSuccess: (_data, variables) => {
      // Join success → org status counts/wait estimates change.
      void invalidateOrgStatusOnJoin(queryClient, orgId, variables.serviceId);
    },
  });
}
