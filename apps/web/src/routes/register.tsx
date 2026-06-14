import { createFileRoute } from "@tanstack/react-router";

import { RegisterForm } from "@/features/auth/components/RegisterForm";

/**
 * Register route. Thin wrapper that renders the auth feature's `RegisterForm`
 * (react-hook-form + shared `registerSchema`); all behavior lives in the feature.
 */
export const Route = createFileRoute("/register")({
	component: RegisterComponent,
});

function RegisterComponent() {
	return (
		<main className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center p-8">
			<RegisterForm />
		</main>
	);
}
