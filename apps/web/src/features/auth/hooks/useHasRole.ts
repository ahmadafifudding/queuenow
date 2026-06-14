/**
 * Role hooks — read the active role from the Auth_Store and answer
 * role/capability questions for conditional rendering (Requirement 5.2).
 *
 * The active role comes from `organization.role` in the login/refresh response,
 * held in the in-memory {@link useAuthStore}. These hooks subscribe to just the
 * role slice so components re-render only when the role actually changes.
 */
import type { UserRoleType } from '@queuenow/shared-types';

import { type Capability, roleHasCapability } from '../capabilities';
import { useAuthStore } from '../stores/auth-store';

/** The active role, or `null` when unauthenticated / no organization. */
export function useActiveRole(): UserRoleType | null {
  return useAuthStore((state) => state.organization?.role ?? null);
}

/**
 * `true` when the active role is one of `roles`.
 *
 * Variadic by design so call sites read naturally:
 * `useHasRole(UserRoleType.OWNER, UserRoleType.ADMIN)`. Returns `false` when
 * unauthenticated or when no roles are supplied.
 */
export function useHasRole(...roles: UserRoleType[]): boolean {
  const role = useActiveRole();
  if (role === null) {
    return false;
  }
  return roles.includes(role);
}

/**
 * Capability-aware check backed by the capability matrix. Prefer this over
 * {@link useHasRole} when gating on a documented capability, so visibility
 * tracks the matrix rather than a hard-coded role list (Requirement 5.3).
 */
export function useHasCapability(capability: Capability): boolean {
  const role = useActiveRole();
  return roleHasCapability(role, capability);
}
