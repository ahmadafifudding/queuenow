import { useMutation, type UseMutationResult } from '@tanstack/react-query';

import { authManager } from '@/lib/auth/auth-manager';

/**
 * Sign the customer out (R6.6, R7.4). Wraps `authManager.signOut`, which deletes
 * both tokens from secure storage, clears the in-memory session mirror (so
 * account UI is gated immediately), and removes account-scoped query data so no
 * account data — including cached history — survives the session.
 */
export function useSignOut(): UseMutationResult<void, Error, void> {
  return useMutation<void, Error, void>({
    mutationFn: () => authManager.signOut(),
  });
}
