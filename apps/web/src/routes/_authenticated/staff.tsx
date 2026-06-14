import { createFileRoute } from "@tanstack/react-router";
import { UserRoleType } from "@queuenow/shared-types";

import { requireRole } from "@/features/auth/route-guards";
import { StaffManagementView, validateStaffSearch } from "@/features/staff";

/** Staff management is restricted to OWNER and ADMIN (steering matrix). */
const MANAGER_ROLES = [UserRoleType.OWNER, UserRoleType.ADMIN] as const;

/**
 * Staff management route (R10).
 *
 * - `beforeLoad` restricts the route to OWNER/ADMIN (R5.4, R10.6); STAFF is
 *   redirected to the dashboard with a toast.
 * - `validateSearch` parses the `page` search param (default 1) so list
 *   pagination is driven from the URL — shareable and back-button friendly
 *   (R10.2, Property 15).
 * The route stays thin (steering): it parses the page, mounts the feature view,
 * and writes page changes back into the search params.
 */
export const Route = createFileRoute("/_authenticated/staff")({
	validateSearch: validateStaffSearch,
	beforeLoad: () => {
		requireRole(MANAGER_ROLES);
	},
	component: StaffComponent,
});

function StaffComponent() {
	const { page } = Route.useSearch();
	const navigate = Route.useNavigate();

	return (
		<StaffManagementView
			page={page}
			onPageChange={(nextPage) => {
				void navigate({ search: { page: nextPage } });
			}}
		/>
	);
}
