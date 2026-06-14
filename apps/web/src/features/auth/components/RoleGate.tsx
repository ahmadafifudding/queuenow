/**
 * `<RoleGate>` — renders its children only when the active role is permitted,
 * for conditional rendering of nav items, buttons, and sections (Requirement
 * 5.2). Hiding UI is a UX affordance, not a security boundary — the backend
 * authorizes every request.
 *
 * Gate on either an explicit role set, a documented capability, or both:
 *
 * ```tsx
 * <RoleGate roles={[UserRoleType.OWNER]}>…</RoleGate>
 * <RoleGate capability="manage-staff">…</RoleGate>
 * ```
 *
 * When both `roles` and `capability` are supplied, both must pass. When neither
 * is supplied the gate is permissive (renders children) so it never silently
 * hides content due to a misconfiguration.
 */
import type { ReactElement, ReactNode } from "react";

import type { UserRoleType } from "@queuenow/shared-types";

import {
	type Capability,
	roleHasCapability,
	roleIsOneOf,
} from "../capabilities";
import { useActiveRole } from "../hooks/useHasRole";

export interface RoleGateProps {
	/** Roles permitted to see the children. */
	roles?: readonly UserRoleType[];
	/** Capability (from the matrix) permitted to see the children. */
	capability?: Capability;
	/** Optional content rendered when access is denied. Defaults to nothing. */
	fallback?: ReactNode;
	/** Content shown only when the active role is permitted. */
	children: ReactNode;
}

/** Conditionally render `children` based on the active role / capability. */
export function RoleGate({
	roles,
	capability,
	fallback = null,
	children,
}: RoleGateProps): ReactElement {
	const role = useActiveRole();

	const passesRoles = roles === undefined || roleIsOneOf(role, roles);
	const passesCapability =
		capability === undefined || roleHasCapability(role, capability);
	const allowed = passesRoles && passesCapability;

	return <>{allowed ? children : fallback}</>;
}
