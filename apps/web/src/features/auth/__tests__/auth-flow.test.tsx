/**
 * Authentication-flow example tests (task 6.6, Requirement 15.2).
 *
 * Behavior-focused coverage of the critical auth flow, mocking the API_Client,
 * router navigation, and toasts at the boundary (no real backend):
 *   1. Login success    → POST /auth/login, store authenticated, navigate /dashboard.
 *   2. Login failure     → general error toast, store stays unauthenticated, no nav.
 *   3. Submit disabled    while the login mutation is pending; re-enabled after.
 *   4. Boot silent refresh → success authenticates the store; failure leaves it
 *      unauthenticated (exercises the real `refreshAccessToken` wired to the store).
 *   5. Logout            → POST /auth/logout, store cleared + navigate /login,
 *      and stays resilient (clear + redirect) even when the request rejects.
 *
 * Mocking strategy:
 *   - `@/lib/api/client` keeps everything real EXCEPT `apiClient.post`, which is a
 *     spy we drive per test. This preserves the real `ApiError` class and the real
 *     `refreshAccessToken` (used by the boot-refresh test against a stubbed fetch).
 *   - `@tanstack/react-router` keeps everything real except `useNavigate` (a spy)
 *     and `Link` (a plain anchor so no RouterProvider is required).
 *   - `sonner` `toast.success` / `toast.error` are spies.
 *   - Components are wrapped in a `QueryClientProvider` using the test harness so
 *     mutations run with retries disabled.
 */
import type { ReactNode } from "react";
import { QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { UserRoleType, type ILoginResponse } from "@queuenow/shared-types";
import {
	afterEach,
	beforeAll,
	beforeEach,
	describe,
	expect,
	it,
	vi,
} from "vitest";

const { navigateMock, toastSuccessMock, toastErrorMock, postMock } = vi.hoisted(
	() => ({
		navigateMock: vi.fn(),
		toastSuccessMock: vi.fn(),
		toastErrorMock: vi.fn(),
		postMock: vi.fn(),
	}),
);

vi.mock("@tanstack/react-router", async (importActual) => {
	const actual = await importActual<typeof import("@tanstack/react-router")>();
	const { createElement } = await import("react");
	return {
		...actual,
		useNavigate: () => navigateMock,
		// Render Link as a plain anchor so the forms need no RouterProvider.
		Link: (props: { to: string; children?: ReactNode }) =>
			createElement("a", { href: props.to }, props.children),
	};
});

vi.mock("sonner", () => ({
	toast: { success: toastSuccessMock, error: toastErrorMock },
}));

vi.mock("@/lib/api/client", async (importActual) => {
	const actual = await importActual<typeof import("@/lib/api/client")>();
	return {
		...actual,
		apiClient: {
			...actual.apiClient,
			// Drive login/logout outcomes per test; keep the rest of the client real.
			post: postMock as unknown as typeof actual.apiClient.post,
		},
	};
});

// Imported AFTER the mocks above so the components/hooks pick up the doubles.
import { LoginForm } from "../components/LoginForm";
import { useLogout } from "../hooks/useLogout";
import { useAuthStore } from "../stores/auth-store";
import { ApiError, refreshAccessToken } from "@/lib/api/client";
import { getErrorMessage } from "@/lib/api/error-map";
import { strings } from "@/i18n";
import { createTestQueryClient } from "@/test/harness";

/** A valid login/refresh session envelope. */
const session: ILoginResponse = {
	user: {
		id: "u1",
		email: "owner@acme.test",
		fullName: "Olwen Owner",
		avatarUrl: null,
	},
	organization: {
		id: "o1",
		name: "Acme",
		slug: "acme",
		role: UserRoleType.OWNER,
	},
	tokens: { accessToken: "access-abc", refreshToken: "refresh-xyz" },
};

/** Build a minimal `Response`-like object the API client can consume. */
function makeResponse(status: number, body: unknown): Response {
	return {
		status,
		ok: status >= 200 && status < 300,
		json: async (): Promise<unknown> => body,
	} as unknown as Response;
}

/** Render a component tree wrapped in a fresh, retry-disabled QueryClient. */
function renderWithClient(ui: ReactNode): void {
	render(
		<QueryClientProvider client={createTestQueryClient()}>
			{ui}
		</QueryClientProvider>,
	);
}

beforeAll(() => {
	// Deterministic base URL so the lazily-validated `env` proxy passes when the
	// real `refreshAccessToken` builds the /auth/refresh URL.
	vi.stubEnv("VITE_API_URL", "http://localhost:4000/api/v1");
	vi.stubEnv("VITE_WS_URL", "http://localhost:4000");
});

beforeEach(() => {
	useAuthStore.getState().clear();
	useAuthStore.setState({ status: "unknown" });
	navigateMock.mockReset();
	toastSuccessMock.mockReset();
	toastErrorMock.mockReset();
	postMock.mockReset();
});

afterEach(() => {
	vi.unstubAllGlobals();
});

describe("authentication flow (task 6.6)", () => {
	it("login success: posts credentials, authenticates the store, navigates to /dashboard", async () => {
		postMock.mockResolvedValueOnce({ data: session });
		const user = userEvent.setup();

		renderWithClient(<LoginForm />);

		await user.type(screen.getByLabelText("Email"), "owner@acme.test");
		await user.type(screen.getByLabelText("Password"), "supersecret");
		await user.click(
			screen.getByRole("button", { name: strings.auth.loginSubmit }),
		);

		await waitFor(() =>
			expect(navigateMock).toHaveBeenCalledWith({ to: "/dashboard" }),
		);

		expect(postMock).toHaveBeenCalledWith("/auth/login", {
			email: "owner@acme.test",
			password: "supersecret",
		});

		const state = useAuthStore.getState();
		expect(state.status).toBe("authenticated");
		expect(state.accessToken).toBe("access-abc");
		expect(state.user).toEqual(session.user);
		expect(state.organization).toEqual(session.organization);

		expect(toastSuccessMock).toHaveBeenCalledWith(strings.auth.loginSuccess);
		expect(toastErrorMock).not.toHaveBeenCalled();
	});

	it("login failure: shows a general error toast, leaves the store unauthenticated, does not navigate", async () => {
		useAuthStore.setState({ status: "unauthenticated" });
		const error = new ApiError(
			"AUTH_INVALID_CREDENTIALS",
			"Invalid credentials",
			undefined,
			401,
		);
		postMock.mockRejectedValueOnce(error);
		const user = userEvent.setup();

		renderWithClient(<LoginForm />);

		await user.type(screen.getByLabelText("Email"), "owner@acme.test");
		await user.type(screen.getByLabelText("Password"), "wrong-password");
		await user.click(
			screen.getByRole("button", { name: strings.auth.loginSubmit }),
		);

		await waitFor(() =>
			expect(toastErrorMock).toHaveBeenCalledWith(getErrorMessage(error)),
		);

		const state = useAuthStore.getState();
		expect(state.status).toBe("unauthenticated");
		expect(state.accessToken).toBeNull();
		expect(navigateMock).not.toHaveBeenCalled();
		expect(toastSuccessMock).not.toHaveBeenCalled();
	});

	it("submit is disabled while the login mutation is pending, then re-enabled", async () => {
		let resolvePost: (value: { data: ILoginResponse }) => void = () => {};
		postMock.mockImplementationOnce(
			() =>
				new Promise<{ data: ILoginResponse }>((resolve) => {
					resolvePost = resolve;
				}),
		);
		const user = userEvent.setup();

		renderWithClient(<LoginForm />);

		await user.type(screen.getByLabelText("Email"), "owner@acme.test");
		await user.type(screen.getByLabelText("Password"), "supersecret");
		await user.click(
			screen.getByRole("button", { name: strings.auth.loginSubmit }),
		);

		// In flight: the button is disabled and shows the pending label.
		await waitFor(() => expect(screen.getByRole("button")).toBeDisabled());
		expect(
			screen.getByRole("button", { name: strings.auth.loginPending }),
		).toBeInTheDocument();

		// Resolve the request: navigation happens and the button is enabled again.
		resolvePost({ data: session });

		await waitFor(() =>
			expect(navigateMock).toHaveBeenCalledWith({ to: "/dashboard" }),
		);
		await waitFor(() => expect(screen.getByRole("button")).toBeEnabled());
	});

	it("boot silent refresh: a successful refresh authenticates the store", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => makeResponse(200, { success: true, data: session })),
		);

		await refreshAccessToken();

		const state = useAuthStore.getState();
		expect(state.status).toBe("authenticated");
		expect(state.accessToken).toBe("access-abc");
		expect(state.user).toEqual(session.user);
	});

	it("boot silent refresh: a failed refresh leaves the store unauthenticated", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn(async () =>
				makeResponse(401, {
					success: false,
					error: { code: "AUTH_TOKEN_INVALID", message: "nope" },
				}),
			),
		);

		await expect(refreshAccessToken()).rejects.toBeInstanceOf(ApiError);

		const state = useAuthStore.getState();
		expect(state.status).toBe("unauthenticated");
		expect(state.accessToken).toBeNull();
		expect(state.user).toBeNull();
	});

	it("logout: posts logout, clears the store, and navigates to /login", async () => {
		useAuthStore.getState().setSession(session);
		postMock.mockResolvedValueOnce({ data: undefined });
		const user = userEvent.setup();

		renderWithClient(<LogoutHarness />);

		await user.click(screen.getByRole("button", { name: "Sign out" }));

		await waitFor(() =>
			expect(navigateMock).toHaveBeenCalledWith({ to: "/login" }),
		);

		expect(postMock).toHaveBeenCalledWith("/auth/logout");
		const state = useAuthStore.getState();
		expect(state.status).toBe("unauthenticated");
		expect(state.accessToken).toBeNull();
		expect(toastSuccessMock).toHaveBeenCalledWith(strings.auth.logoutSuccess);
	});

	it("logout is resilient: clears the store and redirects even when the request rejects", async () => {
		useAuthStore.getState().setSession(session);
		postMock.mockRejectedValueOnce(
			new ApiError("INTERNAL_ERROR", "network down"),
		);
		const user = userEvent.setup();

		renderWithClient(<LogoutHarness />);

		await user.click(screen.getByRole("button", { name: "Sign out" }));

		await waitFor(() =>
			expect(navigateMock).toHaveBeenCalledWith({ to: "/login" }),
		);

		const state = useAuthStore.getState();
		expect(state.status).toBe("unauthenticated");
		expect(state.accessToken).toBeNull();
	});
});

/** Minimal host that wires the `useLogout` action to a clickable control. */
function LogoutHarness(): ReactNode {
	const { logout } = useLogout();
	return (
		<button type="button" onClick={logout}>
			Sign out
		</button>
	);
}
