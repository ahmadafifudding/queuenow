import { createFileRoute, Link } from "@tanstack/react-router";

/** Landing / entry route. Thin route delegating to feature UI later. */
export const Route = createFileRoute("/")({
	component: IndexComponent,
});

function IndexComponent() {
	return (
		<main className="mx-auto flex min-h-screen max-w-2xl flex-col items-center justify-center gap-4 p-8 text-center">
			<h1 className="text-3xl font-bold tracking-tight">QueueNow</h1>
			<p className="text-muted-foreground">
				Queue management dashboard. Project scaffold is in place.
			</p>
			<Link
				to="/dashboard"
				className="text-primary underline underline-offset-4"
			>
				Go to dashboard
			</Link>
		</main>
	);
}
