/**
 * Favorites query + mutation hooks (R8.1, R8.2, R8.3).
 *
 * {@link useFavorites} reads the signed-in customer's favorites through the
 * single shared `apiClient` + TanStack Query on the central
 * `queryKeys.favorites()` key. The request is `authenticated` (Bearer) and the
 * query is DISABLED while signed out — account-scoped data is never fetched
 * without a session, and the cache is dropped on sign-out by the Auth_Manager
 * (R7.4). The signed-in status is read from the in-memory auth mirror so the
 * query enables/disables as the session changes.
 *
 * {@link useAddFavorite} / {@link useRemoveFavorite} drive
 * `POST /customers/favorites/:orgId` and `DELETE /customers/favorites/:orgId`
 * respectively; both invalidate `queryKeys.favorites()` on success so the list
 * reflects the change (design invalidation rule, R8.2/R8.3).
 *
 * Boundaries (`apiClient`) are injectable via the `deps` parameter so the flow
 * can be tested without a live backend.
 */
import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from '@tanstack/react-query';

import { apiClient as defaultApiClient, type ApiClient, type ApiError } from '@/lib/api/client';
import { invalidateFavorites } from '@/lib/api/invalidation';
import { queryKeys } from '@/lib/api/query-keys';
import { useAuthStore } from '@/lib/auth/auth-store';

import type { FavoriteItem } from './types';

/** Backend path for the favorites collection (consumed verbatim, R8.1). */
const FAVORITES_PATH = '/customers/favorites';

/** Build the per-organization favorite path for add/remove (R8.2, R8.3). */
function favoritePath(orgId: string): string {
  return `${FAVORITES_PATH}/${encodeURIComponent(orgId)}`;
}

/** Injectable boundaries for the favorites hooks; optional with real defaults. */
export interface UseFavoritesDeps {
  /** REST client used for the favorites calls. Defaults to the shared {@link apiClient}. */
  apiClient?: ApiClient;
}

/**
 * Fetch the signed-in customer's favorite organizations (R8.1).
 *
 * The query is enabled only while signed in; signed out it stays idle (no
 * fetch) and the screen shows the account prompt instead. The request is
 * authenticated, so the client attaches the Bearer token and fails closed if it
 * is missing.
 *
 * @param deps Optional injected boundaries (for tests).
 * @returns The TanStack Query result; `data` is the favorites list.
 */
export function useFavorites(deps: UseFavoritesDeps = {}): UseQueryResult<FavoriteItem[]> {
  const api = deps.apiClient ?? defaultApiClient;
  const isSignedIn = useAuthStore((state) => state.status === 'signed-in');

  return useQuery({
    queryKey: queryKeys.favorites(),
    enabled: isSignedIn,
    queryFn: async (): Promise<FavoriteItem[]> => {
      const { data } = await api.get<FavoriteItem[]>(FAVORITES_PATH, { authenticated: true });
      return data;
    },
  });
}

/**
 * Mark an organization as a favorite (R8.2). Calls
 * `POST /customers/favorites/:orgId` and invalidates the favorites list on
 * success so the new entry appears.
 *
 * @param deps Optional injected boundaries (for tests).
 * @returns The TanStack mutation result; the variable is the target `orgId`.
 */
export function useAddFavorite(
  deps: UseFavoritesDeps = {},
): UseMutationResult<void, ApiError, string> {
  const api = deps.apiClient ?? defaultApiClient;
  const queryClient = useQueryClient();

  return useMutation<void, ApiError, string>({
    mutationFn: async (orgId): Promise<void> => {
      await api.post<unknown>(favoritePath(orgId), undefined, { authenticated: true });
    },
    onSuccess: () => {
      void invalidateFavorites(queryClient);
    },
  });
}

/**
 * Remove an organization from favorites (R8.3). Calls
 * `DELETE /customers/favorites/:orgId` and invalidates the favorites list on
 * success so the entry disappears.
 *
 * @param deps Optional injected boundaries (for tests).
 * @returns The TanStack mutation result; the variable is the target `orgId`.
 */
export function useRemoveFavorite(
  deps: UseFavoritesDeps = {},
): UseMutationResult<void, ApiError, string> {
  const api = deps.apiClient ?? defaultApiClient;
  const queryClient = useQueryClient();

  return useMutation<void, ApiError, string>({
    mutationFn: async (orgId): Promise<void> => {
      await api.delete<unknown>(favoritePath(orgId), { authenticated: true });
    },
    onSuccess: () => {
      void invalidateFavorites(queryClient);
    },
  });
}
