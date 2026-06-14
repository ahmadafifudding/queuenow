/**
 * OrgSwitcher — authenticated AppShell control for viewing and changing the
 * active organization (org-switching R5).
 *
 * A thin composition over the shadcn-style dropdown menu primitive in
 * `components/ui`. It reads the membership list via `useOrganizations()` and
 * switches via `useSwitchOrganization()`; all post-switch side effects (token
 * swap, socket reconnect, org-scoped cache invalidation) live in that mutation
 * hook, so this component is purely presentational + intent.
 *
 * Behavior:
 * - Renders one entry per organization with a persistent selected-state marker
 *   on exactly the active entry (R5.3). The active entry is derived from the
 *   auth store's `organization.id` (which `setSession` updates on switch), not
 *   from the list's `active` flag — the membership list is user-scoped and not
 *   refetched on switch, so its `active` flag can be stale.
 * - With ≤ 1 membership the control is a static, non-interactive label and never
 *   a menu (R5.11).
 * - Selecting the already-active organization is a no-op — no network call
 *   (R5.5). Selecting another organization calls the switch mutation with that
 *   `orgId` (R5.4).
 * - While a switch is in flight the trigger shows a pending state and further
 *   selections are ignored (R5.6).
 * - A failed list fetch surfaces inline and leaves the active organization
 *   unchanged (R5.2). A failed switch surfaces a code-mapped message via
 *   `getErrorMessage` with all state untouched (R5.12).
 *
 * Hiding/disabling is a usability measure only; the Auth_API remains the sole
 * authorization boundary for organization access (R6.6).
 */
import { useMemo, type ReactElement } from "react";
import { ChevronsUpDown } from "lucide-react";
import type { OrganizationMembership } from "@queuenow/shared-types";

import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuLabel,
	DropdownMenuRadioItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { getErrorMessage } from "@/lib/api/error-map";
import { useOrganizations } from "@/features/auth/api/useOrganizations";
import { useSwitchOrganization } from "@/features/auth/api/useSwitchOrganization";
import { useAuthStore } from "@/features/auth/stores/auth-store";
import { cn } from "@/lib/utils";
import { strings } from "@/i18n";

/** Props for {@link OrgSwitcher}. */
export interface OrgSwitcherProps {
	/** Optional class applied to the switcher root for layout in the AppShell. */
	className?: string;
}

/**
 * The organization switcher mounted in the authenticated AppShell. Renders
 * nothing until the membership list resolves to at least one organization.
 */
export function OrgSwitcher({
	className,
}: OrgSwitcherProps): ReactElement | null {
	const copy = strings.orgSwitcher;
	const activeOrgId = useAuthStore((state) => state.organization?.id ?? null);
	const activeOrgName = useAuthStore(
		(state) => state.organization?.name ?? null,
	);

	const organizationsQuery = useOrganizations();
	const switchOrganization = useSwitchOrganization();

	const organizations = useMemo<OrganizationMembership[]>(
		() => organizationsQuery.data ?? [],
		[organizationsQuery.data],
	);

	// R5.2 — a failed list fetch surfaces inline; the active org is left as-is.
	if (organizationsQuery.isError) {
		return (
			<p className={cn("text-sm text-destructive", className)} role="alert">
				{copy.listFetchFailed}
			</p>
		);
	}

	// While the list is loading, show a non-interactive placeholder.
	if (organizationsQuery.isLoading) {
		return (
			<p
				className={cn("text-sm text-muted-foreground", className)}
				aria-busy="true"
			>
				{strings.common.loading}
			</p>
		);
	}

	// R5.11 — with no organizations there is nothing to switch; hide entirely.
	if (organizations.length === 0) {
		return null;
	}

	// R5.11 — a single membership renders as a static, disabled label (no menu).
	if (organizations.length === 1) {
		const only = organizations[0];
		if (only === undefined) {
			return null;
		}
		return (
			<p
				className={cn(
					"truncate text-sm font-medium text-foreground",
					className,
				)}
			>
				<span className="sr-only">{copy.label}: </span>
				{only.name}
			</p>
		);
	}

	const isSwitching = switchOrganization.isPending;
	const triggerLabel = isSwitching
		? copy.pending
		: (activeOrgName ?? organizations[0]?.name ?? "");

	const handleSelect = (orgId: string): void => {
		// R5.6 — ignore selections while a switch is in flight.
		if (isSwitching) {
			return;
		}
		// R5.5 — selecting the active organization is a no-op (no network call).
		if (orgId === activeOrgId) {
			return;
		}
		// R5.4 — switch to the chosen organization.
		switchOrganization.mutate(orgId);
	};

	return (
		<div className={cn("flex flex-col gap-1", className)}>
			<DropdownMenu>
				<DropdownMenuTrigger
					disabled={isSwitching}
					aria-busy={isSwitching}
					className={cn(
						"inline-flex w-full items-center justify-between gap-2 rounded-md border border-input bg-background px-3 py-2 text-sm font-medium",
						"hover:bg-accent hover:text-accent-foreground",
						"focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
						"disabled:cursor-not-allowed disabled:opacity-50",
					)}
				>
					<span className="sr-only">{copy.label}</span>
					<span className="truncate">{triggerLabel}</span>
					<ChevronsUpDown
						className="h-4 w-4 shrink-0 opacity-60"
						aria-hidden="true"
					/>
				</DropdownMenuTrigger>

				<DropdownMenuContent className="min-w-[14rem]">
					<DropdownMenuLabel>{copy.label}</DropdownMenuLabel>
					<DropdownMenuSeparator />
					{organizations.map((organization) => {
						const isActive = organization.id === activeOrgId;
						return (
							<DropdownMenuRadioItem
								key={organization.id}
								checked={isActive}
								disabled={isSwitching}
								onClick={() => handleSelect(organization.id)}
							>
								<span className="truncate">{organization.name}</span>
								{!organization.isActive ? (
									<span className="ml-auto rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
										{copy.inactiveBadge}
									</span>
								) : null}
							</DropdownMenuRadioItem>
						);
					})}
				</DropdownMenuContent>
			</DropdownMenu>

			{/* R5.12 — a failed switch surfaces a code-mapped message; state untouched. */}
			{switchOrganization.isError ? (
				<p className="text-sm text-destructive" role="alert">
					{getErrorMessage(switchOrganization.error)}
				</p>
			) : null}
		</div>
	);
}
