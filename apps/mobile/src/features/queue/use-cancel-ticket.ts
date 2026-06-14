/**
 * Leave / cancel-ticket mutation hook (R11.1, R11.3, R11.4).
 *
 * {@link useCancelTicket} drives the public, ownership-scoped cancel endpoint
 * `POST /organizations/:orgId/queue/ticket/:ticketId/cancel` (added by task
 * 16.1) through the single shared `apiClient`. The endpoint authorizes by
 * ownership, so the request body proves ownership the SAME way the ticket was
 * joined (see {@link buildJoinRequest}): it always carries the stable anonymous
 * `deviceFingerprint` (R2.3) and additionally carries `customerProfileId` when a
 * customer account session is active (R2.6). Either positive match authorizes;
 * a non-`WAITING` ticket is rejected with `QUEUE_INVALID_STATUS` (R11.4).
 *
 * Graceful degradation (R11 is a backend dependency): the screen treats a
 * `404`/`501` outcome as "leave isn't available yet" and keeps the ticket
 * visible — never faking a cancellation client-side. The two code-/status-keyed
 * predicates below ({@link isInvalidTicketStatusError},
 * {@link isCancelUnavailableError}) let the screen branch without ever matching
 * on backend message text (R10.4).
 *
 * Boundaries (`apiClient`, `authManager`, `authStore`) are injectable via
 * {@link UseCancelTicketDeps} so the flow can be tested without a live backend.
 */
import { ERROR_CODES } from '@queuenow/shared-constants';
import type { IQueueTicket } from '@queuenow/shared-types';
import { useMutation, type UseMutationResult } from '@tanstack/react-query';

import { ApiError, apiClient as defaultApiClient, type ApiClient } from '@/lib/api/client';
import { authManager as defaultAuthManager, type AuthManager } from '@/lib/auth/auth-manager';
import { authStore as defaultAuthStore } from '@/lib/auth/auth-store';

/** The minimal auth-store surface the hook reads (the signed-in profile id). */
interface AuthStoreLike {
  getState(): { customer: { id: string } | null };
}

/**
 * The ownership body sent to the cancel endpoint. Mirrors the backend
 * `CancelTicketDto`: both fields are optional, but at least the
 * `deviceFingerprint` is always present for an anonymous-joined ticket.
 */
export interface CancelTicketBody {
  /** Anonymous ownership proof — always present for a device-joined ticket (R2.3). */
  deviceFingerprint?: string;
  /** Signed-in ownership proof — present only when signed in (R2.6). */
  customerProfileId?: string;
}

/** Inputs to the PURE {@link buildCancelTicketBody} helper. */
export interface BuildCancelBodyInput {
  /** The stable anonymous device fingerprint. */
  deviceFingerprint: string;
  /** Whether a customer account session is active. */
  isSignedIn: boolean;
  /** The signed-in customer's profile id, when available. */
  customerProfileId?: string | null;
}

/** Injectable boundaries for {@link useCancelTicket}; all optional with real defaults. */
export interface UseCancelTicketDeps {
  /** REST client used to POST the cancellation. Defaults to the shared {@link apiClient}. */
  apiClient?: ApiClient;
  /** Auth manager for fingerprint + signed-in status. Defaults to the shared one. */
  authManager?: AuthManager;
  /** In-memory session mirror for the customer profile id. Defaults to the shared one. */
  authStore?: AuthStoreLike;
}

/** Build the public cancel-ticket path (R11.1). Ids are URL-encoded. */
export function cancelTicketPath(orgId: string, ticketId: string): string {
  return `/organizations/${encodeURIComponent(orgId)}/queue/ticket/${encodeURIComponent(
    ticketId,
  )}/cancel`;
}

/**
 * Construct the ownership body for the cancel request. The body proves ownership
 * the same way the ticket was joined: a non-empty `deviceFingerprint` is always
 * included (R2.3), and `customerProfileId` is included only when signed in
 * (R2.6). Pure and side-effect free.
 *
 * @param input The fingerprint + session state.
 * @returns The cancel request body.
 */
export function buildCancelTicketBody(input: BuildCancelBodyInput): CancelTicketBody {
  const body: CancelTicketBody = {};

  if (typeof input.deviceFingerprint === 'string' && input.deviceFingerprint.trim().length > 0) {
    body.deviceFingerprint = input.deviceFingerprint;
  }

  if (input.isSignedIn && input.customerProfileId) {
    body.customerProfileId = input.customerProfileId;
  }

  return body;
}

/**
 * Code-keyed predicate: `true` when the cancel was rejected because the ticket is
 * no longer `WAITING` (R11.4). Keyed only on `ApiError.code`, never on message
 * text (R10.4). The screen responds by showing the mapped message and refetching
 * the ticket state.
 */
export function isInvalidTicketStatusError(error: unknown): boolean {
  return error instanceof ApiError && error.code === ERROR_CODES.QUEUE_INVALID_STATUS;
}

/**
 * Status-keyed predicate: `true` when the cancel endpoint is not available yet —
 * an HTTP `404` (route absent) or `501` (not implemented). Because the leave
 * capability is a backend dependency (R11), the screen degrades gracefully on
 * this outcome: it shows a "not available yet" message and keeps the ticket
 * visible rather than faking a cancellation client-side.
 */
export function isCancelUnavailableError(error: unknown): boolean {
  return error instanceof ApiError && (error.httpStatus === 404 || error.httpStatus === 501);
}

/**
 * Build the leave/cancel mutation for an Active_Ticket. The mutation takes no
 * variables; the fingerprint and signed-in profile id are resolved internally at
 * submit time (mirroring {@link useJoinQueue}). On success the screen stops live
 * tracking and shows the "no longer in queue" view (R11.3).
 *
 * @param orgId The organization the ticket belongs to.
 * @param ticketId The ticket to cancel.
 * @param deps Optional injected boundaries (for tests).
 * @returns The TanStack mutation result.
 */
export function useCancelTicket(
  orgId: string,
  ticketId: string,
  deps: UseCancelTicketDeps = {},
): UseMutationResult<IQueueTicket, ApiError, void> {
  const api = deps.apiClient ?? defaultApiClient;
  const auth = deps.authManager ?? defaultAuthManager;
  const store = deps.authStore ?? defaultAuthStore;

  return useMutation<IQueueTicket, ApiError, void>({
    mutationFn: async (): Promise<IQueueTicket> => {
      const deviceFingerprint = await auth.getDeviceFingerprint();
      const isSignedIn = auth.isSignedIn();
      const customerProfileId = isSignedIn ? (store.getState().customer?.id ?? null) : null;

      const body = buildCancelTicketBody({ deviceFingerprint, isSignedIn, customerProfileId });

      const { data } = await api.post<IQueueTicket>(cancelTicketPath(orgId, ticketId), body);
      return data;
    },
  });
}
