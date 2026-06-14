import { useMutation, type UseMutationResult } from '@tanstack/react-query';
import type { CustomerRegisterInput } from '@queuenow/shared-validation';

import { ApiError } from '@/lib/api/client';
import { authManager, type CustomerSession } from '@/lib/auth/auth-manager';

/**
 * Register a new customer account (R6.1). Wraps `authManager.register`, which
 * validates the input with the shared `customerRegisterSchema`, calls
 * `POST /customers/register`, and write-confirms both tokens before flipping the
 * session to "signed in". A backend rejection (e.g. `CUSTOMER_EMAIL_EXISTS`)
 * propagates BEFORE any token write, so nothing is persisted on failure; the
 * error surfaces here as the mutation error.
 */
export function useRegister(): UseMutationResult<CustomerSession, ApiError, CustomerRegisterInput> {
  return useMutation<CustomerSession, ApiError, CustomerRegisterInput>({
    mutationFn: (input) => authManager.register(input),
  });
}
