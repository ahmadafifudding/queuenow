/**
 * usePlanFeatures — resolve the active org's plan feature flags for UI gating
 * (Requirements 9.1–9.4).
 *
 * Wraps {@link usePlanUsage}, reading the org id from the in-memory auth store
 * (the same source every other org-scoped hook uses), and returns the plan's
 * `features` map (`{ tvDisplay, analytics, customBranding }`). The `AppShell`
 * feeds this map to the pure {@link PlanFeatures} predicates to mirror the
 * API's feature gates in navigation.
 *
 * While plan-usage is loading or unavailable (no org, error), this returns an
 * empty map so unknown flags are treated as enabled — real navigation is never
 * hidden mid-load and no upgrade entry is shown until a flag is known disabled.
 * The API remains the authoritative enforcement boundary (R9.5).
 */
import { usePlanUsage } from '@/features/organization/api/usePlanUsage';

import { useAuthStore } from '../stores/auth-store';
import type { PlanFeatures } from '../nav-visibility';

/**
 * Read the active org's plan feature flags.
 *
 * @returns the resolved feature map, or an empty map while unknown/loading.
 */
export function usePlanFeatures(): PlanFeatures {
  const orgId = useAuthStore((state) => state.organization?.id ?? null);
  const { data } = usePlanUsage({ orgId: orgId ?? '', enabled: Boolean(orgId) });
  return data?.features ?? {};
}
