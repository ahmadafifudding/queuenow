import { HttpException, HttpStatus } from '@nestjs/common';
import { ERROR_CODES } from '@queuenow/shared-constants';
import type { FeatureFlag, PlanLimitName, PlanType } from '@queuenow/shared-types';

/**
 * Structured `details` for a `PLAN_LIMIT_EXCEEDED` rejection caused by exceeding a
 * numeric resource limit (R7.3, R7.5).
 */
export interface NumericLimitDetails {
  /** The named `PLAN_LIMITS` field that was exceeded (e.g. `maxServices`). */
  limitName: PlanLimitName;
  /** The numeric limit that was hit. */
  limit: number;
  /** Usage measured at the moment of the attempt. */
  currentUsage: number;
  /** The organization's current plan (R7.5 — always present). */
  plan: PlanType;
}

/**
 * Structured `details` for a `PLAN_LIMIT_EXCEEDED` rejection caused by a disabled
 * feature flag (R7.4, R7.5). Omits the numeric `limit`/`currentUsage` values.
 */
export interface FeatureFlagDetails {
  /** The feature flag whose surface was denied (e.g. `tvDisplay`). */
  flag: FeatureFlag;
  /** The organization's current plan (R7.5 — always present). */
  plan: PlanType;
}

/** Discriminated union of the two `PLAN_LIMIT_EXCEEDED` detail shapes. */
export type PlanLimitExceededDetails = NumericLimitDetails | FeatureFlagDetails;

/** Type guard distinguishing numeric-limit details from feature-flag details. */
function isNumericLimitDetails(details: PlanLimitExceededDetails): details is NumericLimitDetails {
  return 'limitName' in details;
}

/**
 * Build a non-empty, human-readable message for either detail variant (R7.2).
 * Always returns a non-empty string regardless of the detail shape.
 */
export function buildMessage(details: PlanLimitExceededDetails): string {
  if (isNumericLimitDetails(details)) {
    return `Plan limit reached for ${details.limitName}: ${details.currentUsage}/${details.limit} on the ${details.plan} plan. Upgrade your plan to add more.`;
  }
  return `The ${details.flag} feature is not available on the ${details.plan} plan. Upgrade your plan to enable it.`;
}

/**
 * Domain exception thrown when a request is rejected for exceeding a numeric plan
 * limit or for accessing a surface whose feature flag is disabled.
 *
 * Carries `{ code, message, details }` on its response object so the shared
 * `HttpExceptionFilter` emits the standard error envelope, and reports HTTP 403
 * via `getStatus()` (R7.2–R7.6).
 */
export class PlanLimitExceededException extends HttpException {
  constructor(details: PlanLimitExceededDetails) {
    super(
      {
        code: ERROR_CODES.PLAN_LIMIT_EXCEEDED,
        message: buildMessage(details),
        details,
      },
      HttpStatus.FORBIDDEN,
    );
  }
}
