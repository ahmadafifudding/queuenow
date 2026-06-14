import { createRootRoute, Outlet } from "@tanstack/react-router";

/** Root route. Renders the matched child route via <Outlet />. */
export const Route = createRootRoute({
	component: RootComponent,
});

function RootComponent() {
	return (
		<div className="min-h-screen bg-background text-foreground antialiased">
			<Outlet />
		</div>
	);
}
