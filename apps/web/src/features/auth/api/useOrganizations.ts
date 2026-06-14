/*
 * useOrganizations — list the current user's organization memberships
 * (org-switching R5.1, R5.2).
 *
 * Reads `GET /auth/organizations` through the single API_Client and the central
 * `queryKeys.organizations()` key. That key is deliberately user-scoped (NOT
 * org-scoped), so the membership list survives an org switch and is not cleared
 * by the post-switch org-scoped cache invalidation.
 *
 * The query is gated on the auth status so it only runs once the session is
 * authenticated — the endpoint requires a valid access token, and running it
 * before then would just 401. On fetch failure the hook surfaces the error via
 * the TanStack Query result while leaving the active organization untouched
 * (R5.2); callers (the Org_Switcher) decide how to render it.
 */
import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import type { OrganizationMembership } from '@queuenow/shared-types';

import { apiClient, type ApiError } from '@/lib/api/client';
import { queryKeys } from '@/lib/api/query-keys';
import { useAuthStore } from '@/features/auth/stores/auth-store';

/**
 * Load every organization the current user belongs to, with their role in each
 * and which one is currently active.
 *
 * @returns The TanStack Query result holding the {@link OrganizationMembership}
 * list. Runs only while the session is authenticated.
 */
export function useOrganizations(): UseQueryResult<OrganizationMembership[], ApiError> {
  const status = useAuthStore((s) => s.status);

  return useQuery<OrganizationMembership[], ApiError>({
    queryKey: queryKeys.organizations(),
    queryFn: async ({ signal }) => {
      const { data } = await apiClient.get<OrganizationMembership[]>('/auth/organizations', {
        signal,
      });
      return data;
    },
    enabled: status === 'authenticated',
  });
}
