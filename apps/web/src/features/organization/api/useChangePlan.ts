/*
 * useChangePlan — change the org's plan (R6, R8).
 *
 * Calls `PATCH /organizations/:id/plan` with `{ plan }` through the single
 * API_Client. This is the interim, OWNER-only manual upgrade path before Stripe
 * billing; the backend authorizes the action (UI gating is not the security
 * boundary).
 *
 * On success it invalidates every query whose data a plan change can affect:
 *   - `planUsage(orgId)` — limits/feature flags recompute against the new plan.
 *   - `org(orgId)` — the org record carries `plan`.
 *   - the plan-gated lists `services`, `counters`, `staff`, and `orgStats` — a
 *     plan change can flip whether new resources may be created / which features
 *     are available, so their views must refetch (R6.7).
 *
 * The `staff` list is paginated (`['staff', orgId, page]`); invalidating by the
 * `['staff', orgId]` prefix matches every page (TanStack Query does partial
 * prefix matching), so no specific page is needed here.
 *
 * Throws a typed `ApiError` on failure so the caller can map `error.code` onto a
 * toast / inline copy.
 */
import { useMutation, useQueryClient, type UseMutationResult } from '@tanstack/react-query';
import type { PlanType } from '@queuenow/shared-types';

import { type ApiError, apiClient } from '@/lib/api/client';
import { queryKeys } from '@/lib/api/query-keys';

import type { OrganizationDetails } from '../types';
import { organizationEndpoints } from './endpoints';

/** The change-plan request body — the target plan to switch the org to. */
export interface ChangePlanInput {
  /** The plan to switch the organization to. */
  plan: PlanType;
}

/**
 * Change-plan mutation. Invalidates the plan-usage, org, and plan-gated list
 * query keys on success so every affected view refetches against the new plan.
 *
 * @param orgId - the organization whose plan is changing.
 * @returns the TanStack Query mutation result.
 */
export function useChangePlan(
  orgId: string,
): UseMutationResult<OrganizationDetails, ApiError, ChangePlanInput> {
  const queryClient = useQueryClient();

  return useMutation<OrganizationDetails, ApiError, ChangePlanInput>({
    mutationFn: async (input) => {
      const { data } = await apiClient.patch<OrganizationDetails>(
        organizationEndpoints.changePlan(orgId),
        input,
      );
      return data;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.planUsage(orgId) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.org(orgId) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.services(orgId) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.counters(orgId) });
      // Prefix match invalidates every paginated staff page for the org.
      void queryClient.invalidateQueries({ queryKey: ['staff', orgId] });
      void queryClient.invalidateQueries({ queryKey: queryKeys.orgStats(orgId) });
    },
  });
}
