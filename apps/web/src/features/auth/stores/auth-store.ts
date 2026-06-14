/**
 * Auth_Store — in-memory authentication/session state (Zustand).
 *
 * Token strategy (steering "Authentication", Requirements 4.3/4.4):
 * - The access token lives ONLY in this store's memory. It is never written to
 *   `localStorage`, `sessionStorage`, or a non-httpOnly cookie. Accordingly this
 *   store is plain `create(...)` with NO persistence middleware — nothing here
 *   is serialized to web storage.
 * - The refresh token is owned by the backend as an httpOnly cookie and is never
 *   handled here. Note that `ILoginResponse.tokens` carries both `accessToken`
 *   and `refreshToken`, but the frontend reads only `accessToken`; the body
 *   `refreshToken` is intentionally ignored.
 *
 * Boot state is `'unknown'` until the silent refresh on boot resolves it to
 * `'authenticated'` or `'unauthenticated'` (wired separately in task 6.2).
 */
import { create } from 'zustand';
import type { ILoginResponse } from '@queuenow/shared-types';

/** Lifecycle of the session as known to the client. */
export type AuthStatus = 'unknown' | 'authenticated' | 'unauthenticated';

/** Authenticated user, as returned in the login/refresh response. */
export type AuthUser = ILoginResponse['user'];

/** Active organization (including the user's role), from the login response. */
export type AuthOrganization = ILoginResponse['organization'];

/** Shape of the in-memory auth store. */
export interface AuthState {
  /** Access token — memory only, NEVER persisted (Requirement 4.4). */
  accessToken: string | null;
  /** The authenticated user, or `null` when not authenticated. */
  user: AuthUser | null;
  /** The active organization and role, or `null` when not authenticated. */
  organization: AuthOrganization | null;
  /** Current session lifecycle status. */
  status: AuthStatus;
  /** Store the token, user, and organization/role from a login/refresh response (Requirement 4.3). */
  setSession: (response: ILoginResponse) => void;
  /** Replace just the access token (used by the silent-refresh flow). */
  setAccessToken: (token: string) => void;
  /** Clear all session state (logout / failed refresh) → `unauthenticated`. */
  clear: () => void;
}

/**
 * In-memory auth store. Created with plain `create` (no `persist`/middleware) so
 * the access token is never written to web storage (Requirement 4.4).
 */
export const useAuthStore = create<AuthState>((set) => ({
  accessToken: null,
  user: null,
  organization: null,
  status: 'unknown',

  setSession: (response) =>
    set({
      // Only the access token is read from the response body; the refresh token
      // is ignored (it is delivered as an httpOnly cookie).
      accessToken: response.tokens.accessToken,
      user: response.user,
      organization: response.organization,
      status: 'authenticated',
    }),

  setAccessToken: (token) => set({ accessToken: token }),

  clear: () =>
    set({
      accessToken: null,
      user: null,
      organization: null,
      status: 'unauthenticated',
    }),
}));
