import { SetMetadata } from '@nestjs/common';
import type { FeatureFlag } from '@queuenow/shared-types';

/** Metadata key under which the required feature flag is stored. */
export const REQUIRES_FEATURE_KEY = 'requiresFeature';

/**
 * Declarative feature-gate decorator. Marks a route handler (or controller) as
 * requiring the given {@link FeatureFlag} to be enabled on the organization's
 * plan. The {@link PlanFeatureGuard} reads this metadata and denies access with
 * `PLAN_LIMIT_EXCEEDED` when the resolved plan does not enable the flag
 * (R3.1, R4.1).
 */
export const RequiresFeature = (flag: FeatureFlag) => SetMetadata(REQUIRES_FEATURE_KEY, flag);
