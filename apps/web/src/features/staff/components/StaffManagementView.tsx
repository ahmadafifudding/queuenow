/*
 * StaffManagementView — the staff-management surface (R10).
 *
 * Composes the invite form, the paginated staff table, and the pager. The page
 * is owned by the route (URL search params, R10.2) and passed in with an
 * `onPageChange` callback that writes the next page back to the URL, so the
 * feature stays decoupled from the router.
 *
 * Role hiding (R10.6): the whole surface is wrapped in `<RoleGate
 * capability="manage-staff">` so the STAFF role never sees staff-management UI,
 * even though the route's `beforeLoad` already redirects STAFF away — defence in
 * depth, and it satisfies the capability-matrix property (Property 7) at the UI
 * layer too.
 */
import type { ReactElement } from "react";

import { DataRegion } from "@/components/DataRegion";
import { RoleGate } from "@/features/auth";
import { useAuthStore } from "@/features/auth/stores/auth-store";
import { getErrorMessage } from "@/lib/api/error-map";
import { strings } from "@/i18n";

import type { StaffListResult } from "../types";
import { useStaffList } from "../api/useStaffList";
import { InviteStaffForm } from "./InviteStaffForm";
import { StaffPager } from "./StaffPager";
import { StaffTable } from "./StaffTable";

/** Props for {@link StaffManagementView}. */
export interface StaffManagementViewProps {
	/** The 1-indexed page to display (from the route search params). */
	page: number;
	/** Write the next page back to the route search params. */
	onPageChange: (nextPage: number) => void;
}

/** The staff-management view: invite + paginated list, gated to managers. */
export function StaffManagementView({
	page,
	onPageChange,
}: StaffManagementViewProps): ReactElement {
	const copy = strings.staff;
	const orgId = useAuthStore((state) => state.organization?.id ?? null);

	const hasOrg = Boolean(orgId);
	const safeOrgId = orgId ?? "";

	const listQuery = useStaffList({ orgId: safeOrgId, page, enabled: hasOrg });

	return (
		<RoleGate capability="manage-staff">
			<section className="mx-auto max-w-5xl p-6">
				<header className="mb-6">
					<h1 className="text-2xl font-semibold tracking-tight">
						{copy.title}
					</h1>
					<p className="mt-1 text-sm text-muted-foreground">{copy.subtitle}</p>
				</header>

				{hasOrg ? (
					<div className="mb-6">
						<h2 className="mb-2 text-sm font-medium">{copy.invite.heading}</h2>
						<InviteStaffForm orgId={safeOrgId} page={page} />
					</div>
				) : null}

				<DataRegion<StaffListResult>
					isLoading={listQuery.isLoading}
					isError={listQuery.isError}
					error={listQuery.error}
					data={listQuery.data}
					isEmpty={(listQuery.data?.members.length ?? 0) === 0}
					emptyMessage={copy.list.empty}
					errorMessage={getErrorMessage(listQuery.error)}
					onRetry={() => {
						void listQuery.refetch();
					}}
					loadingLabel={copy.title}
				>
					{(data) => (
						<div>
							<StaffTable members={data.members} />
							<StaffPager
								page={data.pagination.page}
								totalPages={data.pagination.totalPages}
								onPageChange={onPageChange}
								disabled={listQuery.isFetching}
							/>
						</div>
					)}
				</DataRegion>
			</section>
		</RoleGate>
	);
}
