import { createFileRoute } from "@tanstack/react-router";
import { UserRoleType } from "@queuenow/shared-types";

import { requireRole } from "@/features/auth/route-guards";
import { ServicesView } from "@/features/services";

/** Services / Counters CRUD is restricted to OWNER and ADMIN (steering matrix, R5.6). */
const MANAGER_ROLES = [UserRoleType.OWNER, UserRoleType.ADMIN] as const;

/**
 * Services management route. Thin per steering "routes stay thin": the role
 * `beforeLoad` guard (OWNER/ADMIN only; R5.4) wraps the feature view, which
 * reads the active org from the Auth_Store and owns the list + CRUD (task 11.1).
 */
export const Route = createFileRoute("/_authenticated/services")({
	beforeLoad: () => {
		requireRole(MANAGER_ROLES);
	},
	component: ServicesComponent,
});

function ServicesComponent() {
	return <ServicesView />;
}
