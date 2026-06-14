import { useMutation, type UseMutationResult } from '@tanstack/react-query';
import type { LoginInput } from '@queuenow/shared-validation';

import { ApiError } from '@/lib/api/client';
import { authManager, type CustomerSession } from '@/lib/auth/auth-manager';

/**
 * Sign in an existing customer (R6.2). Wraps `authManager.login`, which validates
 * the input with the shared `loginSchema`, calls `POST /customers/login`, and —
 * on success — write-confirms both tokens before flipping the session to
 * "signed in". On invalid credentials the manager throws an {@link ApiError}
 * (e.g. `AUTH_INVALID_CREDENTIALS`) BEFORE any token is written, so no token is
 * stored (R6.3); the error surfaces here as the mutation error.
 */
export function useLogin(): UseMutationResult<CustomerSession, ApiError, LoginInput> {
  return useMutation<CustomerSession, ApiError, LoginInput>({
    mutationFn: (input) => authManager.login(input),
  });
}
