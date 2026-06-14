/**
 * useLogin — TanStack Query mutation for the login flow (Requirements 4.1, 4.3).
 *
 * Calls `POST /auth/login` through the single API_Client and, on success,
 * populates the in-memory Auth_Store via `setSession` (token + user + org/role).
 * The mutation surfaces `isPending` so the form can disable submit while the
 * request is in flight (R4.9), and throws a typed `ApiError` on failure so the
 * caller can map `error.details` onto fields and `error.code` onto a toast
 * (R4.10).
 */
import { useMutation, type UseMutationResult } from '@tanstack/react-query';
import type { ILoginResponse } from '@queuenow/shared-types';
import type { LoginInput } from '@queuenow/shared-validation';

import { apiClient, type ApiError } from '@/lib/api/client';

import { useAuthStore } from '../stores/auth-store';

/** Login mutation. Stores the session on success; never persists the token. */
export function useLogin(): UseMutationResult<ILoginResponse, ApiError, LoginInput> {
  const setSession = useAuthStore((state) => state.setSession);

  return useMutation<ILoginResponse, ApiError, LoginInput>({
    mutationFn: async (credentials) => {
      const { data } = await apiClient.post<ILoginResponse>('/auth/login', credentials);
      return data;
    },
    onSuccess: (data) => {
      setSession(data);
    },
  });
}
