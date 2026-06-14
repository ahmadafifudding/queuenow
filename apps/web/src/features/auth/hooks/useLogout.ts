/**
 * useLogout — sign-out action (Requirement 4.8).
 *
 * Calls `POST /auth/logout` to revoke the refresh token, then clears the
 * Auth_Store and redirects to `/login`. The clear + redirect run in `onSettled`,
 * so the user is signed out locally and sent to the login screen even if the
 * network call fails (resilient logout) — the in-memory token is the only thing
 * that grants access, and we always drop it.
 *
 * Exposes a stable `logout()` callback suitable for the AppShell `onSignOut`
 * prop (task 7.2). Wire it where AppShell is rendered, e.g.
 * `const { logout } = useLogout(); <AppShell onSignOut={logout} />`.
 */
import { useCallback } from 'react';
import { useMutation } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { toast } from 'sonner';

import { apiClient, type ApiError } from '@/lib/api/client';
import { strings } from '@/i18n';

import { useAuthStore } from '../stores/auth-store';

/** Result of {@link useLogout}: a stable action plus its pending flag. */
export interface UseLogoutResult {
  /** Trigger logout: revoke server-side, clear local session, redirect to login. */
  logout: () => void;
  /** `true` while the logout request is in flight. */
  isPending: boolean;
}

/** Logout hook. Always clears the session and redirects, even on network error. */
export function useLogout(): UseLogoutResult {
  const navigate = useNavigate();
  const clear = useAuthStore((state) => state.clear);

  const { mutate, isPending } = useMutation<void, ApiError, void>({
    mutationFn: async () => {
      await apiClient.post('/auth/logout');
    },
    onSettled: () => {
      // Resilient: clear + redirect regardless of whether the request succeeded.
      clear();
      toast.success(strings.auth.logoutSuccess);
      void navigate({ to: '/login' });
    },
  });

  const logout = useCallback(() => {
    mutate();
  }, [mutate]);

  return { logout, isPending };
}
