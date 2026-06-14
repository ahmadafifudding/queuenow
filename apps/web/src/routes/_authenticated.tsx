import { useEffect, type ReactNode } from "react";
import {
	createFileRoute,
	Link,
	Outlet,
	useRouterState,
} from "@tanstack/react-router";
import {
	AppShell,
	DEFAULT_NAV_ITEMS,
	type AppShellNavItem,
	useLogout,
} from "@/features/auth";
import {
	flushRestrictionToast,
	requireAuthenticated,
} from "@/features/auth/route-guards";

/**
 * Pathless layout route for the authenticated Dashboard surface.
 *
 * - `beforeLoad` runs the auth guard: unauthenticated visitors are redirected to
 *   `/login` before any nested route loads (Requirement 5.1).
 * - The outlet is wrapped in the role-gated {@link AppShell} (task 7.2), so the
 *   navigation and action controls hide per the capability matrix. Sign-out is
 *   wired to {@link useLogout} (task 6.3).
 * - The component drains any pending role-restriction toast once a navigation
 *   settles, so a redirect queued by a child route's role guard surfaces on the
 *   dashboard (Requirement 5.4).
 */
export const Route = createFileRoute("/_authenticated")({
	beforeLoad: () => {
		requireAuthenticated();
	},
	component: AuthenticatedLayout,
});

/**
 * Navigation entries that have a real route today. The default set includes a
 * `billing` item, but no `/billing` route exists yet — filter it out so the
 * shell never renders a dead link.
 */
const NAV_ITEMS: readonly AppShellNavItem[] = DEFAULT_NAV_ITEMS.filter(
	(item) => item.key !== "billing",
);

/** Render a nav entry as a client-side TanStack `<Link>` (preserves the in-memory session). */
function renderNavLink(item: AppShellNavItem, content: ReactNode): ReactNode {
	return (
		<Link
			to={item.href}
			className="flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring [&.active]:bg-accent [&.active]:text-accent-foreground"
		>
			{content}
		</Link>
	);
}

function AuthenticatedLayout() {
	const { logout } = useLogout();

	// Re-render on navigation lifecycle changes so we can flush a queued
	// restriction toast after the redirect to `/dashboard` settles. This covers
	// direct URL entry, programmatic navigation, and same-path bounce-backs.
	const routerStatus = useRouterState({ select: (state) => state.status });

	useEffect(() => {
		if (routerStatus === "idle") {
			flushRestrictionToast();
		}
	}, [routerStatus]);

	return (
		<AppShell
			navItems={NAV_ITEMS}
			renderNavLink={renderNavLink}
			onSignOut={logout}
		>
			<Outlet />
		</AppShell>
	);
}
