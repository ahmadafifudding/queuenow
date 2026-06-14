import { createFileRoute } from "@tanstack/react-router";
import { UserRoleType } from "@queuenow/shared-types";

import { CountersView } from "@/features/counters";
import { requireRole } from "@/features/auth/route-guards";

/** Services / Counters CRUD is restricted to OWNER and ADMIN (steering matrix, R5.6). */
const MANAGER_ROLES = [UserRoleType.OWNER, UserRoleType.ADMIN] as const;

/**
 * Counters management route (R9). Thin per steering "routes stay thin": the
 * `beforeLoad` role guard keeps STAFF out (redirect + toast), and the feature
 * view reads the active org from the Auth_Store and owns the list/CRUD UI.
 */
export const Route = createFileRoute("/_authenticated/counters")({
	beforeLoad: () => {
		requireRole(MANAGER_ROLES);
	},
	component: CountersComponent,
});

function CountersComponent() {
	return <CountersView />;
}
