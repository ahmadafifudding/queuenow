/**
 * useRegister — TanStack Query mutation for the registration flow
 * (Requirements 4.2, 4.3).
 *
 * Calls `POST /auth/register` (which creates the owner + organization and
 * returns a full session, same shape as login) through the single API_Client.
 * On success it populates the in-memory Auth_Store via `setSession`, so the new
 * owner is immediately authenticated. Mirrors `useLogin` for pending state and
 * typed `ApiError` failures used for field-error and toast mapping (R4.9, R4.10).
 */
import { useMutation, type UseMutationResult } from '@tanstack/react-query';
import type { ILoginResponse } from '@queuenow/shared-types';
import type { RegisterInput } from '@queuenow/shared-validation';

import { apiClient, type ApiError } from '@/lib/api/client';

import { useAuthStore } from '../stores/auth-store';

/** Registration mutation. Stores the returned session on success. */
export function useRegister(): UseMutationResult<ILoginResponse, ApiError, RegisterInput> {
  const setSession = useAuthStore((state) => state.setSession);

  return useMutation<ILoginResponse, ApiError, RegisterInput>({
    mutationFn: async (input) => {
      const { data } = await apiClient.post<ILoginResponse>('/auth/register', input);
      return data;
    },
    onSuccess: (data) => {
      setSession(data);
    },
  });
}
