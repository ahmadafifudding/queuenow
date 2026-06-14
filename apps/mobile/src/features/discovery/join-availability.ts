/**
 * PURE join-availability decision for discovery (R1.3, R1.4).
 *
 * Given the outcome of resolving an organization's public queue status, decide
 * whether to present a join action and how the selection UI should behave:
 *
 *  - Present a join action IFF resolution succeeded for an active org exposing
 *    at least one active service (R1.4). The status endpoint only ever returns
 *    ACTIVE services for an ACTIVE org, so a non-empty services array is exactly
 *    that condition.
 *  - For an error outcome (e.g. `ORG_NOT_FOUND` / `ORG_INACTIVE`), present NO
 *    join action and surface an error (R1.3).
 *  - Require explicit service selection when more than one active service is
 *    available; auto-select the single service otherwise (R1.4).
 *
 * This function is PURE and side-effect free (no I/O, no `Date`, no randomness)
 * so it can be exercised directly by the Property 2 test (task 7.3).
 */
import { ERROR_CODES } from '@queuenow/shared-constants';

import type {
  DiscoveryServiceStatus,
  DiscoveryServiceSummary,
  JoinAvailabilityDecision,
  JoinAvailabilityInput,
  OrgQueueStatus,
} from './types';

/**
 * The error codes that specifically denote an org that cannot be joined because
 * it was not found or is inactive (R1.3). Any OTHER error code is still treated
 * as a non-joinable error outcome, but these are the canonical discovery codes.
 */
export const DISCOVERY_BLOCKING_ERROR_CODES: readonly string[] = [
  ERROR_CODES.ORG_NOT_FOUND,
  ERROR_CODES.ORG_INACTIVE,
];

/**
 * Compute the join-availability decision from a resolution outcome.
 *
 * @param input Either an `errorCode` (resolution failed) or the active
 *   `services` (resolution succeeded; may be empty for an active org with no
 *   active services).
 * @returns The pure decision describing whether/how a join action is presented.
 */
export function joinAvailability(input: JoinAvailabilityInput): JoinAvailabilityDecision {
  // Error outcome → no join action, show the error (R1.3).
  if (input.errorCode) {
    return {
      presentJoinAction: false,
      showError: true,
      errorCode: input.errorCode,
      isEmpty: false,
      requiresServiceSelection: false,
      services: [],
      preselectedServiceId: null,
    };
  }

  const services = input.services ?? [];

  // Active org but no active services → empty state, no join action (R1.4).
  if (services.length === 0) {
    return {
      presentJoinAction: false,
      showError: false,
      errorCode: null,
      isEmpty: true,
      requiresServiceSelection: false,
      services: [],
      preselectedServiceId: null,
    };
  }

  // Active org with ≥1 active service → present a join action (R1.4).
  const requiresServiceSelection = services.length > 1;
  const [firstService] = services;
  return {
    presentJoinAction: true,
    showError: false,
    errorCode: null,
    isEmpty: false,
    requiresServiceSelection,
    services,
    preselectedServiceId: requiresServiceSelection ? null : (firstService?.id ?? null),
  };
}

/**
 * Normalize the raw public status payload into the {@link DiscoveryServiceSummary}
 * list the decision and selection UI consume. Pure helper kept beside the
 * decision so callers never hand the raw response shape to {@link joinAvailability}.
 *
 * @param status The org queue-status response.
 * @returns The active services as normalized summaries.
 */
export function normalizeServices(status: OrgQueueStatus): DiscoveryServiceSummary[] {
  return status.services.map(toServiceSummary);
}

/** Map one raw per-service status entry to a normalized summary. */
function toServiceSummary(entry: DiscoveryServiceStatus): DiscoveryServiceSummary {
  return {
    id: entry.service.id,
    name: entry.service.name,
    prefix: entry.service.prefix,
    waiting: entry.waiting,
    estimatedWaitMinutes: entry.estimatedWaitMinutes,
  };
}
