import { createFileRoute } from "@tanstack/react-router";
import { UserRoleType } from "@queuenow/shared-types";
import { requireRole } from "@/features/auth/route-guards";
import { OrganizationSettingsView } from "@/features/organization";

/** Org settings / branding is restricted to OWNER and ADMIN (steering matrix). */
const MANAGER_ROLES = [UserRoleType.OWNER, UserRoleType.ADMIN] as const;

/**
 * Organization settings route (Phase 3, R11).
 *
 * The role `beforeLoad` guard keeps this OWNER/ADMIN-only (Requirement 5.4); the
 * page renders the org details, branding, and queue-settings forms, applies the
 * org's brand color on load (R11.3), and gates the org-deletion control to OWNER
 * via `<RoleGate>` inside the view (R11.7).
 */
export const Route = createFileRoute("/_authenticated/settings")({
	beforeLoad: () => {
		requireRole(MANAGER_ROLES);
	},
	component: SettingsComponent,
});

function SettingsComponent() {
	return <OrganizationSettingsView />;
}
