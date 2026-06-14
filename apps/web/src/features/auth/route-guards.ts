/**
 * Route-level guards for the authenticated Dashboard surface (Requirements 5.1,
 * 5.4). These run inside TanStack Router `beforeLoad`, which executes in a
 * non-React context — so they read session state imperatively via
 * `useAuthStore.getState()` rather than the React hook.
 *
 * Scope note: this module owns ONLY the route-level `beforeLoad` checks. The
 * shared capability matrix, `useHasRole`, and `<RoleGate>` are intentionally
 * left to task 7.2. Each role-restricted route passes its own allowed-role set
 * to {@link requireRole}, so there is no shared matrix to collide with here.
 *
 * Restriction-toast strategy: a `beforeLoad` guard cannot render a toast while a
 * navigation/redirect is in flight. Instead an unauthorized role check stashes a
 * one-time message in a tiny module-level queue ({@link queueRestrictionToast})
 * and throws a redirect to `/dashboard`. The `_authenticated` layout drains the
 * queue with {@link flushRestrictionToast} once the navigation settles, so the
 * `sonner` toast renders on the destination (Requirement 5.4).
 */
import { redirect } from '@tanstack/react-router';
import { toast } from 'sonner';
import { ERROR_CODES } from '@queuenow/shared-constants';
import type { UserRoleType } from '@queuenow/shared-types';
import { strings } from '@/i18n';
import { useAuthStore } from '@/features/auth/stores/auth-store';

/**
 * One-shot, module-level holder for a pending restriction message. Kept tiny and
 * private; producers use {@link queueRestrictionToast} and the layout consumes
 * it via {@link flushRestrictionToast}.
 */
let pendingRestrictionMessage: string | null = null;

/** Default copy for a role restriction, sourced from the centralized catalog. */
const DEFAULT_RESTRICTION_MESSAGE = strings.errors[ERROR_CODES.AUTH_FORBIDDEN];

/** Stash a one-time restriction message to be toasted after the redirect settles. */
export function queueRestrictionToast(message: string): void {
  pendingRestrictionMessage = message;
}

/** Remove and return the pending restriction message, if any. */
export function takeRestrictionToast(): string | null {
  const message = pendingRestrictionMessage;
  pendingRestrictionMessage = null;
  return message;
}

/**
 * Render any pending restriction message as an error toast, then clear it.
 * Safe to call repeatedly — it no-ops when the queue is empty.
 */
export function flushRestrictionToast(): void {
  const message = takeRestrictionToast();
  if (message !== null) {
    toast.error(message);
  }
}

/**
 * Auth guard for the `_authenticated` layout (Requirement 5.1).
 *
 * The boot silent-refresh resolves the `'unknown'` status before the router
 * renders, so here any non-`'authenticated'` status is treated as unauthenticated
 * and redirected to `/login`.
 */
export function requireAuthenticated(): void {
  if (useAuthStore.getState().status !== 'authenticated') {
    throw redirect({ to: '/login' });
  }
}

/**
 * Role guard for role-restricted routes (Requirement 5.4).
 *
 * When the active role is not in `allowedRoles`, queues a restriction toast and
 * redirects to `/dashboard`. Assumes the auth guard has already run on the parent
 * layout, so the user is authenticated and the role is hydrated.
 *
 * @param allowedRoles Roles permitted to view the route.
 * @param message Optional override for the restriction copy.
 */
export function requireRole(
  allowedRoles: readonly UserRoleType[],
  message: string = DEFAULT_RESTRICTION_MESSAGE,
): void {
  const role = useAuthStore.getState().organization?.role ?? null;
  if (role === null || !allowedRoles.includes(role)) {
    queueRestrictionToast(message);
    throw redirect({ to: '/dashboard' });
  }
}
