/**
 * PURE join-request construction + verbatim result projection (R2.1–R2.7).
 *
 * {@link buildJoinRequest} assembles the `POST /organizations/:orgId/queue/join`
 * body from the join inputs and the session state, then validates it against the
 * shared `joinQueueSchema` BEFORE anything is sent. The construction rules
 * (Property 3, task 8.2) are:
 *
 *  - the request targets `POST /organizations/:orgId/queue/join` (R2.1),
 *  - it ALWAYS carries a non-empty `deviceFingerprint` (R2.3) — the shared schema
 *    marks it optional, so this module enforces non-emptiness explicitly,
 *  - it includes `customerName` / `customerPhone` EXACTLY when provided (R2.2),
 *  - it includes `customerProfileId` EXACTLY when signed in (R2.6),
 *  - it is sent IFF `joinQueueSchema` validates the body — invalid input never
 *    reaches the network (R2.7).
 *
 * {@link toJoinedTicketDisplay} projects the join response into the displayed
 * `ticketNumber` / `position` / `estimatedWaitMinutes` with NO client-side
 * arithmetic, so the displayed `position`/wait equal the backend values
 * verbatim (Property 4, task 8.3; R2.4).
 *
 * Everything here is PURE and side-effect free (no I/O, no `Date`, no
 * randomness), so both helpers are exercised directly by their property tests.
 */
import { joinQueueSchema, type JoinQueueInput } from '@queuenow/shared-validation';

import type {
  BuildJoinRequestInput,
  BuildJoinRequestResult,
  JoinedTicket,
  JoinedTicketDisplay,
} from './types';

/**
 * Build the join endpoint path for an organization (R2.1). Pure; the org id is
 * URL-encoded so a non-canonical identifier can never break out of the path
 * segment.
 *
 * @param orgId The organization id the join is scoped to.
 * @returns The `POST` path `/organizations/:orgId/queue/join`.
 */
export function joinQueuePath(orgId: string): string {
  return `/organizations/${encodeURIComponent(orgId)}/queue/join`;
}

/**
 * Normalize an optional contact field. A value counts as "provided" only when it
 * is a non-blank string; blank/whitespace-only/`undefined` is treated as absent
 * so it is omitted from the body (R2.2).
 */
function normalizeOptional(value: string | undefined): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

/**
 * Construct and validate a queue-join request (R2.1–R2.3, R2.6, R2.7).
 *
 * The returned result is either a `valid` request (the target `path` and the
 * schema-validated `body`, safe to send) or an `invalid` outcome carrying the
 * flattened `issues` — when invalid, callers MUST NOT send anything (R2.7).
 *
 * @param input The join inputs plus the current session state.
 * @returns The pure build result describing whether/what to send.
 */
export function buildJoinRequest(input: BuildJoinRequestInput): BuildJoinRequestResult {
  const path = joinQueuePath(input.orgId);

  // Assemble the candidate body. Optional fields are added only when present.
  const body: JoinQueueInput = {
    serviceId: input.serviceId,
    deviceFingerprint: input.deviceFingerprint,
  };

  const customerName = normalizeOptional(input.customerName);
  if (customerName !== undefined) {
    body.customerName = customerName; // R2.2 — exactly when provided.
  }

  const customerPhone = normalizeOptional(input.customerPhone);
  if (customerPhone !== undefined) {
    body.customerPhone = customerPhone; // R2.2 — exactly when provided.
  }

  if (input.isSignedIn && input.customerProfileId) {
    body.customerProfileId = input.customerProfileId; // R2.6 — exactly when signed in.
  }

  // R2.3 — the shared schema marks `deviceFingerprint` optional, but an
  // anonymous join MUST always carry a non-empty one. Enforce it explicitly so a
  // missing/blank fingerprint is invalid (and therefore never sent).
  const hasFingerprint =
    typeof body.deviceFingerprint === 'string' && body.deviceFingerprint.trim().length > 0;

  // R2.7 — validate against the shared schema before sending.
  const parsed = joinQueueSchema.safeParse(body);

  if (!parsed.success) {
    return { valid: false, issues: parsed.error.flatten() };
  }

  if (!hasFingerprint) {
    return {
      valid: false,
      issues: {
        formErrors: [],
        fieldErrors: { deviceFingerprint: ['A device fingerprint is required.'] },
      },
    };
  }

  return { valid: true, path, body: parsed.data };
}

/**
 * Project a successful join response into its displayed fields with NO
 * client-side arithmetic — the displayed `position` and `estimatedWaitMinutes`
 * equal the backend values verbatim (R2.4; Property 4, task 8.3).
 *
 * @param ticket The joined ticket returned by the backend.
 * @returns The verbatim display projection.
 */
export function toJoinedTicketDisplay(ticket: JoinedTicket): JoinedTicketDisplay {
  return {
    ticketNumber: ticket.ticketNumber,
    position: ticket.position,
    estimatedWaitMinutes: ticket.estimatedWaitMinutes,
  };
}
