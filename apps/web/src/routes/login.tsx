import { createFileRoute } from "@tanstack/react-router";

import { LoginForm } from "@/features/auth/components/LoginForm";

/**
 * Login route. Thin wrapper that renders the auth feature's `LoginForm`
 * (TanStack Form + shared `loginSchema`); all behavior lives in the feature.
 */
export const Route = createFileRoute("/login")({
	component: LoginComponent,
});

function LoginComponent() {
	return (
		<main className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center p-8">
			<LoginForm />
		</main>
	);
}
