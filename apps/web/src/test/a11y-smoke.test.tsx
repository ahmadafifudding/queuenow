/**
 * Accessibility smoke tests (task 18.2, Requirements 13.1, 13.2, 13.3).
 *
 * Automated `axe` checks over a representative subset of the app's key screens,
 * asserting `expect(await axe(container)).toHaveNoViolations()`. These guard the
 * cross-cutting accessibility baseline established in task 18.1:
 *   - R13.1 — interactive elements are keyboard-reachable with valid roles/names
 *     (axe flags unlabelled controls, invalid `tabindex`, etc.).
 *   - R13.2 — shadcn/Radix ARIA semantics are preserved in our wrappers (axe
 *     flags invalid/oprhaned `aria-*`, bad roles, missing names).
 *   - R13.3 — the Display board's high-contrast, text+icon "now calling" state
 *     carries valid semantics (the no-color-only requirement is verified by the
 *     dedicated display tests; here we assert the board has no ARIA violations).
 *
 * Screens covered (a representative subset, per the task):
 *   1. LoginForm           — public auth entry (rendered inside its route `<main>`).
 *   2. ServicesView         — a dashboard list + form surface (seeded auth org).
 *   3. DisplayBoard         — the public TV board (mocked public query + no-op
 *                             realtime hooks, mirroring the display tests).
 *   4. Kiosk start screen  — the public ServiceSelection step of `KioskScreen`.
 *
 * Intentionally skipped here (documented):
 *   - The Kiosk details/ticket steps and the Display sound-unlock overlay are
 *     interaction states already covered by `kiosk-flow.test.tsx` /
 *     `sound-unlock-overlay.test.tsx`; the start/board render is the
 *     representative a11y surface for these public screens.
 *   - Counters/Staff/Organization views share the same `<DataRegion>` + shadcn
 *     primitives as ServicesView, so ServicesView is the representative
 *     dashboard surface (covering them would be redundant for a smoke test).
 *
 * axe configuration (shared `AXE_OPTIONS`):
 *   - `color-contrast` is disabled because jsdom performs no layout/painting, so
 *     contrast cannot be computed (it would only ever report "incomplete").
 *     Contrast for the Display is a visual-design concern verified separately.
 *   - `region` is disabled because these are component-subtree renders, not full
 *     documents; the page-level "all content in a landmark" best-practice rule
 *     is not meaningful when axe is scoped to a single screen's container.
 *   All other rules (ARIA validity, control names, roles, labels, tabindex …)
 *   stay enabled — those are exactly the R13.1/R13.2 semantics under test.
 *
 * Mocking strategy (boundary only — no implementation is modified):
 *   - `@tanstack/react-router` keeps everything real except `useNavigate` (a
 *     spy) and `Link` (a plain anchor) so `LoginForm` renders without a router.
 *   - `sonner` toasts are spies.
 *   - The Display's public query (`useDisplayQueue`) is mocked to settled data,
 *     and its realtime side-effect hooks are no-ops, so the board mounts cleanly.
 *   - `@/lib/api/client` keeps everything real except `apiClient.get`, routed by
 *     path to feed the ServicesView list and the Kiosk active-services/settings
 *     reads.
 */
import type { ReactElement, ReactNode } from "react";
import { QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import { UserRoleType, type ILoginResponse } from "@queuenow/shared-types";
import type { IService } from "@queuenow/shared-types";
import { axe } from "vitest-axe";
import type { RunOptions } from "axe-core";
import {
	afterEach,
	beforeAll,
	beforeEach,
	describe,
	expect,
	it,
	vi,
} from "vitest";

import type { DisplayQueueStatus } from "@/features/display/types";

const { navigateMock, getMock } = vi.hoisted(() => ({
	navigateMock: vi.fn(),
	getMock: vi.fn(),
}));

vi.mock("@tanstack/react-router", async (importActual) => {
	const actual = await importActual<typeof import("@tanstack/react-router")>();
	const { createElement } = await import("react");
	return {
		...actual,
		useNavigate: () => navigateMock,
		Link: (props: { to: string; children?: ReactNode }) =>
			createElement("a", { href: props.to }, props.children),
	};
});

vi.mock("sonner", () => ({
	toast: { success: vi.fn(), error: vi.fn() },
}));

// Display realtime side-effects → no-ops so the board mounts without a socket.
vi.mock("@/hooks/useSocketSubscription", () => ({
	useSocketSubscription: vi.fn(),
}));
vi.mock("@/hooks/usePollingFallback", () => ({
	usePollingFallback: vi.fn(),
}));

const { useDisplayQueueMock } = vi.hoisted(() => ({
	useDisplayQueueMock: vi.fn(),
}));
vi.mock("@/features/display/api/useDisplayQueue", () => ({
	useDisplayQueue: useDisplayQueueMock,
}));

vi.mock("@/lib/api/client", async (importActual) => {
	const actual = await importActual<typeof import("@/lib/api/client")>();
	return {
		...actual,
		apiClient: {
			...actual.apiClient,
			get: getMock as unknown as typeof actual.apiClient.get,
		},
	};
});

// Imported AFTER the mocks so components/hooks pick up the doubles.
import { ApiError } from "@/lib/api/client";
import { createTestQueryClient } from "@/test/harness";
import { useAuthStore } from "@/features/auth";
import { LoginForm } from "@/features/auth/components/LoginForm";
import { ServicesView } from "@/features/services/components/ServicesView";
import { serviceEndpoints } from "@/features/services/api/endpoints";
import { DisplayBoard } from "@/features/display/components/DisplayBoard";
import { KioskScreen } from "@/features/kiosk/components/KioskScreen";
import { kioskEndpoints } from "@/features/kiosk/api/endpoints";

const ORG_ID = "org-1";

/**
 * Shared axe run options. See the file header for why `color-contrast` and
 * `region` are disabled; every other rule stays on.
 */
const AXE_OPTIONS: RunOptions = {
	rules: {
		"color-contrast": { enabled: false },
		region: { enabled: false },
	},
};

/** A session whose active org is the one the dashboard views read. */
const session: ILoginResponse = {
	user: {
		id: "u1",
		email: "owner@acme.test",
		fullName: "Olwen Owner",
		avatarUrl: null,
	},
	organization: {
		id: ORG_ID,
		name: "Acme",
		slug: "acme",
		role: UserRoleType.OWNER,
	},
	tokens: { accessToken: "access-abc", refreshToken: "refresh-xyz" },
};

/** One active service for the ServicesView list. */
function makeService(): IService {
	return {
		id: "svc-general",
		orgId: ORG_ID,
		name: "General",
		prefix: "GEN",
		isActive: true,
		sortOrder: 0,
		avgServingTime: 5,
		maxQueuePerDay: null,
	};
}

/** A settled public display payload with one currently-called ticket. */
function makeDisplayStatus(): DisplayQueueStatus {
	return {
		organizationId: ORG_ID,
		organizationName: "Acme Clinic",
		services: [
			{
				service: { id: "svc-general", name: "General", prefix: "A" },
				waiting: 3,
				currentlyCalled: [{ ticketNumber: "A001", counterName: "Counter 1" }],
				serving: 1,
				completedToday: 10,
				estimatedWaitMinutes: 12,
			},
		],
		lastUpdated: "2024-01-01T08:00:00.000Z",
	};
}

/** Render a tree wrapped in a fresh, retry-disabled QueryClient. */
function renderWithClient(ui: ReactElement): HTMLElement {
	const { container } = render(
		<QueryClientProvider client={createTestQueryClient()}>
			{ui}
		</QueryClientProvider>,
	);
	return container;
}

beforeAll(() => {
	// Deterministic base URL so the real client module imports cleanly.
	vi.stubEnv("VITE_API_URL", "http://localhost:4000/api/v1");
	vi.stubEnv("VITE_WS_URL", "http://localhost:4000");
});

beforeEach(() => {
	navigateMock.mockReset();
	getMock.mockReset();
	useDisplayQueueMock.mockReset();
	useAuthStore.getState().clear();
});

afterEach(() => {
	cleanup();
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
});

describe("accessibility smoke (task 18.2, R13.1/R13.2/R13.3)", () => {
	it("LoginForm has no axe violations", async () => {
		const container = renderWithClient(
			<main className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center p-8">
				<LoginForm />
			</main>,
		);

		// The form is present synchronously; assert then run axe.
		expect(screen.getByLabelText("Email")).toBeInTheDocument();
		expect(await axe(container, AXE_OPTIONS)).toHaveNoViolations();
	});

	it("ServicesView (dashboard list) has no axe violations", async () => {
		useAuthStore.getState().setSession(session);
		getMock.mockImplementation(async (path: string) => {
			if (path === serviceEndpoints.list(ORG_ID)) {
				return { data: [makeService()] };
			}
			throw new ApiError("INTERNAL_ERROR", `unexpected GET ${path}`);
		});

		const container = renderWithClient(<ServicesView />);

		// Wait until the list has rendered before auditing.
		await screen.findByText("General");
		expect(await axe(container, AXE_OPTIONS)).toHaveNoViolations();
	});

	it("DisplayBoard (public TV board) has no axe violations", async () => {
		useDisplayQueueMock.mockReturnValue({
			data: makeDisplayStatus(),
			isLoading: false,
			isError: false,
			error: null,
			refetch: vi.fn(),
		});

		const { container } = render(<DisplayBoard orgId={ORG_ID} />);

		// The called-ticket tile is rendered from the mocked data.
		await screen.findByText("A001");
		expect(await axe(container, AXE_OPTIONS)).toHaveNoViolations();
	});

	it("Kiosk start screen (service selection) has no axe violations", async () => {
		getMock.mockImplementation(async (path: string) => {
			if (path === kioskEndpoints.activeServices(ORG_ID)) {
				return {
					data: {
						services: [
							{
								service: { id: "svc-general", name: "General", prefix: "GEN" },
							},
						],
					},
				};
			}
			if (path === kioskEndpoints.queueSettings(ORG_ID)) {
				return { data: { requireName: false, requirePhone: false } };
			}
			throw new ApiError("INTERNAL_ERROR", `unexpected GET ${path}`);
		});

		const container = renderWithClient(<KioskScreen orgId={ORG_ID} />);

		// Wait for the active-service tile on the start screen.
		await screen.findByRole("button", { name: /General/ });
		expect(await axe(container, AXE_OPTIONS)).toHaveNoViolations();
	});
});
