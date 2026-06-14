// Feature: plan-limit-enforcement, Property 13: Navigation visibility mirrors capability and plan feature flags
//
// Validates: Requirements 9.1, 9.2, 9.3, 9.4
//
// For any active role and any set of plan feature flags:
//   - a plan-only nav item is visible IFF the role satisfies its capability AND
//     its feature flag is enabled;
//   - an upgrade entry appears in place of a gated surface IFF the active role
//     is OWNER AND that surface's feature flag is disabled.
//
// The decision logic under test is the pure `isNavItemVisible` /
// `shouldShowUpgradeEntry` pair, so the property runs without rendering React.
// fast-check + Vitest, 200 runs.
import { type FeatureFlag, UserRoleType } from '@queuenow/shared-types';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { type Capability, CAPABILITY_MATRIX, roleHasCapability } from './capabilities';
import {
  type NavVisibilityItem,
  type PlanFeatures,
  isNavItemVisible,
  shouldShowUpgradeEntry,
} from './nav-visibility';

const RUNS = 200;

const CAPABILITIES = Object.keys(CAPABILITY_MATRIX) as Capability[];
const FEATURE_FLAGS: FeatureFlag[] = ['tvDisplay', 'analytics', 'customBranding'];
const ROLES: UserRoleType[] = [UserRoleType.OWNER, UserRoleType.ADMIN, UserRoleType.STAFF];

/** Active role, including the unauthenticated `null` case. */
const roleArb: fc.Arbitrary<UserRoleType | null> = fc.constantFrom<(UserRoleType | null)[]>(
  ...ROLES,
  null,
);

/** A nav item that may be capability-gated and/or feature-gated. */
const itemArb: fc.Arbitrary<NavVisibilityItem> = fc.record({
  capability: fc.option(fc.constantFrom(...CAPABILITIES), { nil: undefined }),
  featureFlag: fc.option(fc.constantFrom(...FEATURE_FLAGS), { nil: undefined }),
});

/** A fully-resolved plan-features map (every flag is a concrete boolean). */
const planFeaturesArb: fc.Arbitrary<PlanFeatures> = fc.record({
  tvDisplay: fc.boolean(),
  analytics: fc.boolean(),
  customBranding: fc.boolean(),
});

describe('Property 13: navigation visibility mirrors capability and plan feature flags', () => {
  it('a plan-only item is visible iff the role satisfies its capability and its flag is enabled', () => {
    fc.assert(
      fc.property(itemArb, roleArb, planFeaturesArb, (item, role, planFeatures) => {
        const capabilityOk =
          item.capability === undefined || roleHasCapability(role, item.capability);
        const flagOk = item.featureFlag === undefined || planFeatures[item.featureFlag] === true;

        expect(isNavItemVisible(item, role, planFeatures)).toBe(capabilityOk && flagOk);
      }),
      { numRuns: RUNS },
    );
  });

  it('an upgrade entry appears iff the role is OWNER and the surface flag is disabled', () => {
    fc.assert(
      fc.property(itemArb, roleArb, planFeaturesArb, (item, role, planFeatures) => {
        const expected =
          item.featureFlag !== undefined &&
          role === UserRoleType.OWNER &&
          planFeatures[item.featureFlag] === false;

        expect(shouldShowUpgradeEntry(item, role, planFeatures)).toBe(expected);
      }),
      { numRuns: RUNS },
    );
  });

  it('a non-feature-gated item never yields an upgrade entry and ignores plan flags', () => {
    const ungatedItemArb: fc.Arbitrary<NavVisibilityItem> = fc.record({
      capability: fc.option(fc.constantFrom(...CAPABILITIES), { nil: undefined }),
    });
    fc.assert(
      fc.property(ungatedItemArb, roleArb, planFeaturesArb, (item, role, planFeatures) => {
        expect(shouldShowUpgradeEntry(item, role, planFeatures)).toBe(false);
        // Visibility for an ungated item depends only on capability.
        const capabilityOk =
          item.capability === undefined || roleHasCapability(role, item.capability);
        expect(isNavItemVisible(item, role, planFeatures)).toBe(capabilityOk);
      }),
      { numRuns: RUNS },
    );
  });

  it('a gated item and its upgrade entry are mutually exclusive for an OWNER', () => {
    const gatedItemArb: fc.Arbitrary<NavVisibilityItem> = fc.record({
      capability: fc.option(fc.constantFrom(...CAPABILITIES), { nil: undefined }),
      featureFlag: fc.constantFrom(...FEATURE_FLAGS),
    });
    fc.assert(
      fc.property(gatedItemArb, planFeaturesArb, (item, planFeatures) => {
        const role = UserRoleType.OWNER;
        const visible = isNavItemVisible(item, role, planFeatures);
        const upgrade = shouldShowUpgradeEntry(item, role, planFeatures);
        // OWNER satisfies every capability, so exactly one of the two shows.
        expect(visible && upgrade).toBe(false);
        expect(visible || upgrade).toBe(true);
      }),
      { numRuns: RUNS },
    );
  });
});
