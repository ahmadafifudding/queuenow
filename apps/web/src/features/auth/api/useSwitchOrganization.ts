/*
 * useSwitchOrganization — switch the active organization and re-issue tokens
 * (org-switching R5.4, R5.7, R5.8, R5.9, R5.10, R5.12).
 *
 * Calls `POST /auth/switch-organization` with the selected `orgId` through the
 * single API_Client. The backend verifies membership, rotates the session, and
 * returns the standard `ILoginResponse` (with the new refresh token delivered as
 * an httpOnly cookie and only `tokens.accessToken` in the body).
 *
 * On success:
 * - `setSession(data)` atomically swaps the in-memory access token (R5.7) and
 *   updates the active `organization` (`id`, `name`, `slug`, `role`) so the
 *   AppShell header and role-gated UI reflect the new org (R5.8).
 * - The realtime socket reconnect is NOT triggered explicitly here: `lib/socket.ts`
 *   `watchTokenChanges()` already subscribes to the auth store and bounces the
 *   connection whenever `accessToken` changes, so `setSession`'s new token drives
 *   the reconnect for us (R5.9).
 * - `invalidateOrgScopedQueries(queryClient)` removes every org-scoped cache entry
 *   so no data from the previous organization remains displayed (R5.10).
 *
 * On failure the mutation rejects, `onSuccess` never runs, and the token, active
 * organization, and query caches are all left untouched (R5.12); callers (the
 * Org_Switcher) surface the error via `error.code`.
 */
import { useMutation, useQueryClient, type UseMutationResult } from '@tanstack/react-query';
import type { ILoginResponse } from '@queuenow/shared-types';

import { apiClient, type ApiError } from '@/lib/api/client';
import { invalidateOrgScopedQueries } from '@/lib/api/invalidate-org-scoped';
import { useAuthStore } from '@/features/auth/stores/auth-store';

/**
 * Switch the current user's active organization to `orgId`, re-issuing tokens
 * scoped to that organization and the user's role there.
 *
 * @returns The TanStack Query mutation result; call `mutate(orgId)` /
 * `mutateAsync(orgId)` with the target organization id.
 */
export function useSwitchOrganization(): UseMutationResult<ILoginResponse, ApiError, string> {
  const setSession = useAuthStore((s) => s.setSession);
  const queryClient = useQueryClient();

  return useMutation<ILoginResponse, ApiError, string>({
    mutationFn: async (orgId) => {
      const { data } = await apiClient.post<ILoginResponse>('/auth/switch-organization', { orgId });
      return data;
    },
    onSuccess: (data) => {
      // R5.7 (access token) + R5.8 (organization + role) — atomic session swap.
      // R5.9 — socket reconnect is handled by lib/socket.ts watchTokenChanges,
      // which reacts to the access-token change; no explicit call here.
      setSession(data);
      // R5.10 — drop all previous-org data so nothing stale renders post-switch.
      invalidateOrgScopedQueries(queryClient);
    },
  });
}
