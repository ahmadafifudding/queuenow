/*
 * Pure plan-usage helpers (R8.2, R8.3, R8.4).
 *
 * These are intentionally UI-free, dependency-free functions so the property
 * tests (Properties 10 and 11) can import them directly without rendering a
 * component or pulling in a DOM / i18n runtime. The `PlanUsageView` composes
 * them; the API stays the authoritative enforcement boundary — these helpers
 * only mirror the server-computed projection for display.
 */
import type { PlanUsageResource, PlanUsageResponse } from '@queuenow/shared-types';

/**
 * Canonical label for an unlimited (`null`) numeric limit. Defined here as the
 * default so the pure formatter has a self-contained representation that the
 * property test can pin (Property 10); the view passes the i18n string in its
 * place so the copy stays centralized/translatable.
 */
export const UNLIMITED_LABEL = 'Unlimited';

/**
 * Format a resource's usage against its limit for display (R8.2, R8.3).
 *
 * Returns exactly `"{usage} / {limit}"` when `limit` is a number, and the
 * unlimited label (default `"Unlimited"`) when `limit` is `null`. This is the
 * Property 10 formatter.
 *
 * @param usage The current usage count (non-negative).
 * @param limit The numeric limit, or `null` for unlimited.
 * @param unlimitedLabel Copy shown when the limit is unlimited; defaults to
 *   {@link UNLIMITED_LABEL} so the function is self-contained for testing.
 * @returns The formatted usage/limit string.
 */
export function formatUsage(
  usage: number,
  limit: number | null,
  unlimitedLabel: string = UNLIMITED_LABEL,
): string {
  return limit === null ? unlimitedLabel : `${usage} / ${limit}`;
}

/**
 * Select the resources that are at (or over) their numeric limit (R8.4).
 *
 * A resource is "at limit" exactly when its limit is a number AND its usage is
 * greater than or equal to that limit; unlimited (`null`) resources are never
 * at limit. The `PlanUsageView` shows a per-resource upgrade prompt for exactly
 * this set, so this is the Property 11 selector. It computes from `usage`/`limit`
 * directly (rather than trusting the projection's `atLimit` flag) so the UI
 * stays correct even if that derived flag drifts.
 *
 * @param projection The plan-usage projection from the API.
 * @returns The subset of resources whose usage meets or exceeds a numeric limit.
 */
export function atLimitResources(projection: PlanUsageResponse): PlanUsageResource[] {
  return projection.resources.filter(
    (resource) => resource.limit !== null && resource.usage >= resource.limit,
  );
}
