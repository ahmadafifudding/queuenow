/**
 * AppShell — the authenticated Dashboard layout (sidebar navigation + header +
 * content outlet) that hides nav items and action controls per the capability
 * matrix (Requirements 5.3, 5.5, 5.6, 5.7).
 *
 * Navigation visibility is derived entirely from {@link CAPABILITY_MATRIX} via
 * the active role, so STAFF never sees Services/Counters/Staff/Settings/Billing,
 * ADMIN never sees Billing, and only OWNER sees Billing and the
 * delete-organization control.
 *
 * Composition / handoff (task 7.1 owns `routes/_authenticated.tsx`):
 * - This component is presentational and route-agnostic. The default nav links
 *   render as semantic anchors so the shell is usable standalone today, before
 *   the role-restricted routes exist in the typed route tree.
 * - The `_authenticated` layout route should render `<AppShell>` around its
 *   `<Outlet />` and pass `renderNavLink` to swap the anchors for type-safe
 *   TanStack `<Link>` elements once those routes are added. No route wiring is
 *   done here to avoid a write conflict with task 7.1.
 */
import { type ReactNode, useState } from "react";
import {
	CreditCard,
	LayoutDashboard,
	type LucideIcon,
	ListOrdered,
	Menu,
	MonitorPlay,
	Settings,
	Sparkles,
	SquareStack,
	Trash2,
	Users,
	Wrench,
	X,
} from "lucide-react";
import type { FeatureFlag } from "@queuenow/shared-types";

import { RoleGate } from "@/features/auth/components/RoleGate";
import type { Capability } from "@/features/auth/capabilities";
import {
	isNavItemVisible,
	shouldShowUpgradeEntry,
} from "@/features/auth/nav-visibility";
import { useActiveRole } from "@/features/auth/hooks/useHasRole";
import { usePlanFeatures } from "@/features/auth/hooks/usePlanFeatures";
import { useAuthStore } from "@/features/auth/stores/auth-store";
import { strings } from "@/i18n";
import { cn } from "@/lib/utils";

/** A single primary-navigation entry, optionally gated by a capability. */
export interface AppShellNavItem {
	/** Stable key for React lists. */
	key: string;
	/** User-facing label (sourced from the i18n catalog). */
	label: string;
	/** Target path. Rendered via {@link AppShellProps.renderNavLink}. */
	href: string;
	/** Icon shown beside the label. */
	icon: LucideIcon;
	/**
	 * Capability required to see this item. When omitted the item is visible to
	 * any authenticated role (e.g. the Dashboard home).
	 */
	capability?: Capability;
	/**
	 * Plan feature flag gating this item. When set, the item is only shown while
	 * the org's plan enables the flag; when the flag is disabled, OWNERs see an
	 * upgrade entry in its place (Requirements 9.1–9.4). Omitted ⇒ not plan-gated.
	 */
	featureFlag?: FeatureFlag;
}

/**
 * Default navigation, mirroring the planned Dashboard routes. Labels come from
 * the i18n catalog (Requirement 14.2); each restricted item is tagged with its
 * matrix capability so the shell can hide it for roles that lack it.
 */
export const DEFAULT_NAV_ITEMS: readonly AppShellNavItem[] = [
	{
		key: "dashboard",
		label: strings.nav.dashboard,
		href: "/dashboard",
		icon: LayoutDashboard,
	},
	{
		key: "queue",
		label: strings.nav.queue,
		href: "/queue",
		icon: ListOrdered,
		capability: "serve-queue",
	},
	{
		key: "services",
		label: strings.nav.services,
		href: "/services",
		icon: Wrench,
		capability: "manage-services-counters",
	},
	{
		key: "counters",
		label: strings.nav.counters,
		href: "/counters",
		icon: SquareStack,
		capability: "manage-services-counters",
	},
	{
		key: "display",
		label: strings.nav.display,
		href: "/display",
		icon: MonitorPlay,
		capability: "manage-org-settings",
		featureFlag: "tvDisplay",
	},
	{
		key: "staff",
		label: strings.nav.staff,
		href: "/staff",
		icon: Users,
		capability: "manage-staff",
	},
	{
		key: "settings",
		label: strings.nav.settings,
		href: "/settings",
		icon: Settings,
		capability: "manage-org-settings",
	},
	{
		key: "billing",
		label: strings.nav.billing,
		href: "/billing",
		icon: CreditCard,
		capability: "manage-billing",
	},
];

export interface AppShellProps {
	/** Routed content (the `<Outlet />` when used as a layout). */
	children?: ReactNode;
	/** Navigation entries; defaults to {@link DEFAULT_NAV_ITEMS}. */
	navItems?: readonly AppShellNavItem[];
	/**
	 * Render a navigation link. Defaults to a semantic anchor. The layout route
	 * (task 7.1) can pass a renderer that returns a typed TanStack `<Link>` once
	 * the target routes exist.
	 */
	renderNavLink?: (item: AppShellNavItem, content: ReactNode) => ReactNode;
	/**
	 * Sign-out handler. Defaults to clearing the in-memory session; task 6.3
	 * wires the full `POST /auth/logout` + redirect.
	 */
	onSignOut?: () => void;
}

function defaultRenderNavLink(
	item: AppShellNavItem,
	content: ReactNode,
): ReactNode {
	return (
		<a
			href={item.href}
			className="flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
		>
			{content}
		</a>
	);
}

/**
 * Role-gated authenticated layout shell. Reads the active role once and renders
 * only the nav items and controls that the matrix permits for that role.
 */
export function AppShell({
	children,
	navItems = DEFAULT_NAV_ITEMS,
	renderNavLink = defaultRenderNavLink,
	onSignOut,
}: AppShellProps): ReactNode {
	const role = useActiveRole();
	const planFeatures = usePlanFeatures();
	const organization = useAuthStore((state) => state.organization);
	const user = useAuthStore((state) => state.user);
	const clear = useAuthStore((state) => state.clear);
	const [mobileNavOpen, setMobileNavOpen] = useState(false);

	// Capability- and plan-driven visibility: an item shows when the active role
	// satisfies its capability AND (it is not plan-gated or its feature flag is
	// not known-disabled). Mirrors the API feature gates (Requirements 9.1–9.3).
	const visibleNavItems = navItems.filter((item) =>
		isNavItemVisible(item, role, planFeatures),
	);

	// In place of each hidden gated surface, OWNERs see an upgrade entry that
	// points at the Plan & Usage section (Requirement 9.4). Presentation only —
	// the API remains the enforcement boundary (R9.5).
	const upgradeNavItems: AppShellNavItem[] = navItems
		.filter((item) => shouldShowUpgradeEntry(item, role, planFeatures))
		.map((item) => ({
			key: `upgrade-${item.key}`,
			label: strings.shell.upgrade,
			href: "/billing",
			icon: Sparkles,
		}));

	const handleSignOut = onSignOut ?? clear;

	const navList = (
		<nav
			aria-label={strings.shell.primaryNavLabel}
			className="flex flex-col gap-1"
		>
			{visibleNavItems.map((item) => {
				const Icon = item.icon;
				const content = (
					<>
						<Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
						<span>{item.label}</span>
					</>
				);
				return <div key={item.key}>{renderNavLink(item, content)}</div>;
			})}
			{upgradeNavItems.map((item) => {
				const Icon = item.icon;
				const content = (
					<>
						<Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
						<span>{item.label}</span>
					</>
				);
				return <div key={item.key}>{renderNavLink(item, content)}</div>;
			})}
		</nav>
	);

	return (
		<div className="flex min-h-screen bg-background text-foreground">
			{/* Desktop sidebar */}
			<aside className="hidden w-64 shrink-0 flex-col border-r border-border bg-card p-4 md:flex">
				<div className="px-3 py-2">
					<p className="truncate text-base font-semibold tracking-tight">
						{organization?.name ?? "QueueNow"}
					</p>
					{role ? (
						<span className="mt-1 inline-flex items-center rounded-full bg-secondary px-2 py-0.5 text-xs font-medium text-secondary-foreground">
							{role}
						</span>
					) : null}
				</div>
				<div className="mt-4 flex-1">{navList}</div>

				{/* OWNER-only action control, gated through the matrix. */}
				<RoleGate capability="delete-organization">
					<div className="mt-4 border-t border-border pt-4">
						<p className="px-3 pb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
							{strings.shell.dangerZone}
						</p>
						<button
							type="button"
							className="flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm font-medium text-destructive transition-colors hover:bg-destructive/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-destructive"
						>
							<Trash2 className="h-4 w-4 shrink-0" aria-hidden="true" />
							<span>{strings.shell.deleteOrganization}</span>
						</button>
					</div>
				</RoleGate>
			</aside>

			<div className="flex min-w-0 flex-1 flex-col">
				{/* Header */}
				<header className="flex items-center justify-between gap-4 border-b border-border bg-card px-4 py-3">
					<button
						type="button"
						aria-label={
							mobileNavOpen ? strings.shell.closeMenu : strings.shell.openMenu
						}
						aria-expanded={mobileNavOpen}
						onClick={() => setMobileNavOpen((open) => !open)}
						className="inline-flex items-center justify-center rounded-md p-2 text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring md:hidden"
					>
						{mobileNavOpen ? (
							<X className="h-5 w-5" aria-hidden="true" />
						) : (
							<Menu className="h-5 w-5" aria-hidden="true" />
						)}
					</button>

					<div className="ml-auto flex items-center gap-3">
						{user ? (
							<span className="hidden truncate text-sm text-muted-foreground sm:inline">
								{user.fullName}
							</span>
						) : null}
						<button
							type="button"
							onClick={handleSignOut}
							className="inline-flex items-center justify-center rounded-md border border-border bg-background px-3 py-1.5 text-sm font-medium transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
						>
							{strings.shell.signOut}
						</button>
					</div>
				</header>

				{/* Mobile nav drawer */}
				{mobileNavOpen ? (
					<div className={cn("border-b border-border bg-card p-4 md:hidden")}>
						{navList}
					</div>
				) : null}

				<main className="min-w-0 flex-1">{children}</main>
			</div>
		</div>
	);
}
