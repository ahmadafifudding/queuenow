/**
 * Capability matrix — the single source of truth for role-based UI visibility.
 *
 * This encodes the steering "Role-Based UI" capability matrix
 * (`.kiro/steering/frontend-web.md`) exactly, once, as a typed
 * capability → allowed-roles lookup. Every nav item, action control, and
 * `<RoleGate>` resolves visibility through this module so the UI stays
 * consistent with the documented matrix (Requirements 5.3, 5.5, 5.6, 5.7).
 *
 * Hiding UI is never the security boundary — the backend authorizes every
 * request — but the UI must not present actions a role cannot perform.
 *
 * | Capability                                | OWNER | ADMIN | STAFF |
 * | ----------------------------------------- | :---: | :---: | :---: |
 * | Serve queue (call/recall/skip/complete)   |   ✓   |   ✓   |   ✓   |
 * | Services / Counters CRUD                  |   ✓   |   ✓   |   –   |
 * | Staff management                          |   ✓   |   ✓   |   –   |
 * | Org settings / branding                   |   ✓   |   ✓   |   –   |
 * | Billing / plan                            |   ✓   |   –   |   –   |
 * | Delete organization                       |   ✓   |   –   |   –   |
 */
import { UserRoleType } from '@queuenow/shared-types';

/** A discrete capability that the UI gates on. One entry per matrix row. */
export type Capability =
  | 'serve-queue'
  | 'manage-services-counters'
  | 'manage-staff'
  | 'manage-org-settings'
  | 'manage-billing'
  | 'delete-organization';

/**
 * Capability → roles permitted to use it. Widened to `readonly UserRoleType[]`
 * (rather than `as const` tuples) so membership checks accept any role value.
 */
export const CAPABILITY_MATRIX: Record<Capability, readonly UserRoleType[]> = {
  'serve-queue': [UserRoleType.OWNER, UserRoleType.ADMIN, UserRoleType.STAFF],
  'manage-services-counters': [UserRoleType.OWNER, UserRoleType.ADMIN],
  'manage-staff': [UserRoleType.OWNER, UserRoleType.ADMIN],
  'manage-org-settings': [UserRoleType.OWNER, UserRoleType.ADMIN],
  'manage-billing': [UserRoleType.OWNER],
  'delete-organization': [UserRoleType.OWNER],
};

/**
 * Pure predicate: does `role` have `capability` per the matrix?
 *
 * Returns `false` for a missing/unknown role so callers can pass the active
 * role straight from the auth store without null-guarding at each call site.
 */
export function roleHasCapability(
  role: UserRoleType | null | undefined,
  capability: Capability,
): boolean {
  if (!role) {
    return false;
  }
  return CAPABILITY_MATRIX[capability].includes(role);
}

/** Pure predicate: is `role` one of `allowedRoles`? */
export function roleIsOneOf(
  role: UserRoleType | null | undefined,
  allowedRoles: readonly UserRoleType[],
): boolean {
  if (!role) {
    return false;
  }
  return allowedRoles.includes(role);
}
