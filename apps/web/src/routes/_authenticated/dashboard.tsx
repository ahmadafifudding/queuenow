import { createFileRoute } from "@tanstack/react-router";

/** Dashboard home. Thin route; the queue panel and shell arrive in later tasks. */
export const Route = createFileRoute("/_authenticated/dashboard")({
	component: DashboardComponent,
});

function DashboardComponent() {
	return (
		<main className="mx-auto max-w-5xl p-8">
			<h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
			<p className="mt-2 text-muted-foreground">
				Authenticated dashboard scaffold.
			</p>
		</main>
	);
}
