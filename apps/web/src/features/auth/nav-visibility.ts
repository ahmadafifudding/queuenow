/**
 * Navigation visibility — the PURE decision logic that mirrors the API's plan
 * feature gates in the authenticated app shell (Requirements 9.1–9.4).
 *
 * Extracting these predicates from the React component keeps them trivially
 * unit/property testable (no rendering) and keeps `AppShell` thin: the shell
 * resolves the active role + plan features and delegates every show/hide
 * decision here.
 *
 * Two distinct decisions are encoded:
 * - {@link isNavItemVisible} — is a (possibly capability- and/or feature-gated)
 *   nav item shown for this role + plan?
 * - {@link shouldShowUpgradeEntry} — should an OWNER-only upgrade CTA appear in
 *   place of a gated surface whose feature flag is disabled (R9.4)?
 *
 * Hiding navigation is NEVER the security boundary — the API authorizes every
 * request (R9.5). This module only mirrors what the plan allows.
 */
import { type FeatureFlag, UserRoleType } from '@queuenow/shared-types';

import { type Capability, roleHasCapability } from './capabilities';

/**
 * Resolved plan feature flags as a partial map. A flag is:
 * - `true`  → the surface is enabled for the org's plan,
 * - `false` → the surface is disabled for the org's plan,
 * - `undefined` → not yet known (plan-usage still loading).
 *
 * Unknown flags are treated as enabled so real navigation is never hidden
 * during load (avoids flicker); the API remains the enforcement boundary, and
 * the OWNER upgrade entry only appears once a flag is *known* to be `false`.
 */
export type PlanFeatures = Partial<Record<FeatureFlag, boolean>>;

/** The structural shape of a nav item needed to decide its visibility. */
export interface NavVisibilityItem {
  /** Capability required to see the item (omitted ⇒ any authenticated role). */
  capability?: Capability;
  /** Plan feature flag gating the item (omitted ⇒ not plan-gated). */
  featureFlag?: FeatureFlag;
}

/**
 * Pure predicate: should `item` be visible for `role` under `planFeatures`?
 *
 * An item is visible when the role satisfies its capability (or it has none)
 * AND it is either not feature-gated or its feature flag is not known-disabled
 * (R9.1–R9.3). An unknown flag (loading) is treated as enabled.
 */
export function isNavItemVisible(
  item: NavVisibilityItem,
  role: UserRoleType | null | undefined,
  planFeatures: PlanFeatures,
): boolean {
  const capabilityOk = item.capability === undefined || roleHasCapability(role, item.capability);
  if (!capabilityOk) {
    return false;
  }
  if (item.featureFlag === undefined) {
    return true;
  }
  // Treat unknown (still-loading) flags as enabled to avoid hiding real nav.
  return planFeatures[item.featureFlag] !== false;
}

/**
 * Pure predicate: should an upgrade entry replace this gated surface's entry?
 *
 * Per R9.4 the upgrade CTA appears in place of a hidden gated surface only for
 * the OWNER role and only when the surface's feature flag is *known* disabled.
 */
export function shouldShowUpgradeEntry(
  item: NavVisibilityItem,
  role: UserRoleType | null | undefined,
  planFeatures: PlanFeatures,
): boolean {
  if (item.featureFlag === undefined) {
    return false;
  }
  return role === UserRoleType.OWNER && planFeatures[item.featureFlag] === false;
}
