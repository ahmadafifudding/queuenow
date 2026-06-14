import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { RouterProvider } from "@tanstack/react-router";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "sonner";
import { router } from "./router";
import { queryClient } from "./lib/api/query-client";
import { refreshAccessToken, setUnauthorizedHandler } from "./lib/api/client";
import { EnvValidationError, validateEnv } from "./lib/env";
import "./index.css";

/*
 * App boot lifecycle (task 6.2). Order is significant:
 *
 *   1. Env validation gate (Requirements 1.3, 1.4) — fail-fast. If a required
 *      `VITE_` variable is missing or malformed, render a full-screen
 *      fatal-config message and STOP; the router is never mounted.
 *   2. Single silent `POST /auth/refresh` (Requirement 4.5) to restore the
 *      session from the httpOnly refresh cookie BEFORE the first render. The
 *      Auth_Store resolves from `'unknown'` to `'authenticated'` (refresh ok)
 *      or `'unauthenticated'` (refresh failed) so route guards (task 7.1) see a
 *      settled status on the very first navigation.
 *   3. Register the unauthorized handler (Requirement 4.7) so a *runtime* 401
 *      whose refresh fails clears the session and redirects to `/login`.
 *   4. Render the router.
 */
const rootElement = document.getElementById("root");

if (!rootElement) {
	throw new Error("Root element #root was not found in index.html");
}

/**
 * Render a minimal, accessible full-screen fatal-config screen. Uses plain DOM
 * (no React/router) so it works even when configuration is broken.
 */
function renderFatalConfigScreen(root: HTMLElement, error: unknown): void {
	const isEnvError = error instanceof EnvValidationError;
	const detail =
		error instanceof Error ? error.message : "Unknown configuration error.";

	const container = document.createElement("div");
	container.setAttribute("role", "alert");
	container.setAttribute("aria-live", "assertive");
	container.style.cssText = [
		"min-height:100vh",
		"display:flex",
		"flex-direction:column",
		"align-items:center",
		"justify-content:center",
		"gap:0.75rem",
		"padding:2rem",
		"text-align:center",
		"font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif",
		"background:#0b0b0c",
		"color:#f4f4f5",
	].join(";");

	const heading = document.createElement("h1");
	heading.textContent = "Configuration error";
	heading.style.cssText = "font-size:1.5rem;font-weight:600;margin:0";

	const intro = document.createElement("p");
	intro.textContent = isEnvError
		? "The app can't start because its environment is misconfigured."
		: "The app can't start due to a configuration error.";
	intro.style.cssText = "margin:0;max-width:42rem;color:#a1a1aa";

	const message = document.createElement("pre");
	message.textContent = detail;
	message.style.cssText = [
		"max-width:42rem",
		"white-space:pre-wrap",
		"word-break:break-word",
		"margin:0",
		"padding:1rem",
		"border-radius:0.5rem",
		"background:#18181b",
		"color:#fca5a5",
		"font-size:0.875rem",
		"text-align:left",
	].join(";");

	const hint = document.createElement("p");
	hint.textContent = "See apps/web/.env.example for the required variables.";
	hint.style.cssText = "margin:0;color:#71717a;font-size:0.875rem";

	container.append(heading, intro, message, hint);
	root.replaceChildren(container);
}

/** Mount the React tree (router + providers) into the given root element. */
function renderApp(root: HTMLElement): void {
	createRoot(root).render(
		<StrictMode>
			<QueryClientProvider client={queryClient}>
				<RouterProvider router={router} />
				<Toaster richColors position="top-right" />
			</QueryClientProvider>
		</StrictMode>,
	);
}

/**
 * Attempt the single silent boot refresh (Requirement 4.5). The Auth_Store is
 * updated by the API_Client itself: `setSession` on success, `clear` on failure.
 *
 * A failed boot refresh is the NORMAL unauthenticated case (no logged-in cookie
 * yet, or it expired) — it is deliberately swallowed here with no error/toast
 * noise. We only need the store status to be settled (`authenticated` or
 * `unauthenticated`) before the first render; the route guards then decide where
 * to send the user. Crucially, the unauthorized → `/login` handler is registered
 * AFTER this attempt so a normal unauthenticated boot does not force public
 * surfaces (Display/Kiosk) to the login route — that redirect is reserved for
 * runtime 401 refresh failures (Requirement 4.7).
 */
async function attemptBootRefresh(): Promise<void> {
	try {
		await refreshAccessToken();
	} catch {
		// Normal unauthenticated boot — the client has already cleared the
		// Auth_Store to `'unauthenticated'`. Nothing more to do.
	}
}

async function boot(root: HTMLElement): Promise<void> {
	// 1. Fail-fast env gate (Requirements 1.3, 1.4) — must run before anything.
	validateEnv();

	// 2. Restore the session from the refresh cookie before the first render
	//    (Requirement 4.5). Resolves the Auth_Store status from `'unknown'`.
	await attemptBootRefresh();

	// 3. From now on, a runtime 401 whose refresh fails clears the session and
	//    redirects to `/login` (Requirement 4.7). Registered after the boot
	//    refresh so the normal unauthenticated boot is not redirected here
	//    (route guards handle protected routes; public routes stay public).
	setUnauthorizedHandler(() => {
		void router.navigate({ to: "/login" });
	});

	// 4. Render the app now that the session status is settled.
	renderApp(root);
}

boot(rootElement).catch((error: unknown) => {
	// Env validation (or another fatal boot error) — render the fatal-config
	// screen instead of mounting the router (fail-fast).
	renderFatalConfigScreen(rootElement, error);
});
