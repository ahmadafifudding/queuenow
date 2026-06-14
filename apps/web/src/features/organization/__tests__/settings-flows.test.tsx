/**
 * Organization settings example tests (task 15.2, Requirements 11.1, 11.2, 11.6,
 * 11.8).
 *
 * Behavior-focused coverage of the three settings flows, driven through the real
 * `OrganizationSettingsView` surface (which wires `OrganizationDetailsForm`,
 * `BrandingForm`, `QueueSettingsForm`, and the create/update hooks) so the
 * assertions reflect what a user actually triggers:
 *   - Update org details (11.1): edit the details form → `apiClient.patch` is
 *     called against the update-organization endpoint with the payload; the
 *     success toast is shown.
 *   - Update branding (11.2): edit the branding form → `apiClient.patch` against
 *     the branding endpoint; success toast; the saved `primaryColor` is applied
 *     to the `--primary` CSS variable at runtime (R11.3, observable side effect).
 *   - Update queue settings (11.6): edit the queue-settings form →
 *     `apiClient.patch` against the settings endpoint; success toast.
 *   - Failure / field errors (11.8): a rejected `ApiError` carrying
 *     `error.details` maps onto the matching form field as an inline error (no
 *     toast); a field-less `ApiError` surfaces a code-mapped toast
 *     (`getErrorMessage`).
 *
 * Mocking strategy (boundary only):
 *   - `@/lib/api/client` keeps everything real EXCEPT `apiClient.get/patch`,
 *     backed by a tiny in-memory organization "backend" so query invalidation +
 *     refetch genuinely reflect mutations. The real `ApiError` class is
 *     preserved so the error paths flow exactly as in production.
 *   - `sonner` `toast.success` / `toast.error` are spies.
 *   - The view runs inside a `QueryClientProvider` from the test harness
 *     (`createTestQueryClient`, retries disabled).
 *   - The active org is seeded into `useAuthStore` (the view reads `orgId` there).
 *
 * These are keepable example tests — they do not modify the organization feature.
 */
import { QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ERROR_CODES } from "@queuenow/shared-constants";
import {
	OrganizationType,
	PlanType,
	UserRoleType,
	type ILoginResponse,
} from "@queuenow/shared-types";
import type {
	UpdateBrandingInput,
	UpdateOrganizationInput,
	UpdateQueueSettingsInput,
} from "@queuenow/shared-validation";
import {
	afterEach,
	beforeAll,
	beforeEach,
	describe,
	expect,
	it,
	vi,
} from "vitest";

const { getMock, patchMock, toastSuccessMock, toastErrorMock } = vi.hoisted(
	() => ({
		getMock: vi.fn(),
		patchMock: vi.fn(),
		toastSuccessMock: vi.fn(),
		toastErrorMock: vi.fn(),
	}),
);

vi.mock("sonner", () => ({
	toast: { success: toastSuccessMock, error: toastErrorMock },
}));

vi.mock("@/lib/api/client", async (importActual) => {
	const actual = await importActual<typeof import("@/lib/api/client")>();
	return {
		...actual,
		apiClient: {
			...actual.apiClient,
			// Drive load/update outcomes per test; keep the rest real.
			get: getMock as unknown as typeof actual.apiClient.get,
			patch: patchMock as unknown as typeof actual.apiClient.patch,
		},
	};
});

// Imported AFTER the mocks so the view/hooks pick up the doubles.
import { ApiError } from "@/lib/api/client";
import { getErrorMessage } from "@/lib/api/error-map";
import { PRIMARY_CSS_VARIABLE, hexToHslChannels } from "@/lib/theme";
import { strings } from "@/i18n";
import { createTestQueryClient } from "@/test/harness";
import { useAuthStore } from "@/features/auth";

import { organizationEndpoints } from "../api/endpoints";
import type {
	OrganizationBranding,
	OrganizationDetails,
	QueueSettings,
} from "../types";
import { OrganizationSettingsView } from "../components/OrganizationSettingsView";

const ORG_ID = "o1";
const copy = strings.organization;

/** A session whose active org is the one the view loads settings for (OWNER). */
const session: ILoginResponse = {
	user: {
		id: "u1",
		email: "owner@acme.test",
		fullName: "Olwen Owner",
		avatarUrl: null,
	},
	organization: {
		id: ORG_ID,
		name: "Acme Clinic",
		slug: "acme-clinic",
		role: UserRoleType.OWNER,
	},
	tokens: { accessToken: "access-abc", refreshToken: "refresh-xyz" },
};

/** The org details returned by `GET /organizations/:id` (incl. branding). */
function makeOrg(): OrganizationDetails {
	return {
		id: ORG_ID,
		name: "Acme Clinic",
		slug: "acme-clinic",
		type: OrganizationType.CLINIC,
		address: null,
		phone: null,
		email: null,
		plan: PlanType.FREE,
		ownerId: "u1",
		timezone: "Asia/Kuala_Lumpur",
		isActive: true,
		createdAt: "2024-01-01T00:00:00.000Z",
		updatedAt: "2024-01-01T00:00:00.000Z",
		branding: {
			orgId: ORG_ID,
			logoUrl: null,
			primaryColor: "#3B82F6",
			qrText: null,
		},
		settings: null,
	};
}

/** The queue settings returned by `GET /organizations/:id/settings`. */
function makeSettings(): QueueSettings {
	return {
		orgId: ORG_ID,
		resetTime: "09:00",
		maxRecall: 3,
		requireName: false,
		requirePhone: false,
		autoSkipTimeout: null,
	};
}

/**
 * A tiny in-memory organization backend so invalidation + refetch reflect
 * mutations exactly like production (the view re-reads after each success).
 */
let org: OrganizationDetails = makeOrg();
let settings: QueueSettings = makeSettings();

function installBackend(): void {
	org = makeOrg();
	settings = makeSettings();

	getMock.mockImplementation(async (path: string) => {
		if (path.endsWith("/settings")) {
			return { data: { ...settings } };
		}
		return { data: { ...org, branding: { ...org.branding } } };
	});

	patchMock.mockImplementation(async (path: string, body?: unknown) => {
		if (path.endsWith("/branding")) {
			const input = body as UpdateBrandingInput;
			const next: OrganizationBranding = {
				orgId: ORG_ID,
				logoUrl: org.branding?.logoUrl ?? null,
				primaryColor: org.branding?.primaryColor ?? "#3B82F6",
				qrText: org.branding?.qrText ?? null,
				...input,
			};
			org = { ...org, branding: next };
			return { data: next };
		}
		if (path.endsWith("/settings")) {
			settings = { ...settings, ...(body as UpdateQueueSettingsInput) };
			return { data: { ...settings } };
		}
		org = { ...org, ...(body as UpdateOrganizationInput) };
		return { data: { ...org, branding: { ...org.branding } } };
	});
}

/** Render the settings view inside a fresh, retry-disabled QueryClient. */
function setup(): void {
	const queryClient = createTestQueryClient();
	render(
		<QueryClientProvider client={queryClient}>
			<OrganizationSettingsView />
		</QueryClientProvider>,
	);
}

beforeAll(() => {
	// Deterministic base URL so the real client module imports cleanly.
	vi.stubEnv("VITE_API_URL", "http://localhost:4000/api/v1");
	vi.stubEnv("VITE_WS_URL", "http://localhost:4000");
});

beforeEach(() => {
	getMock.mockReset();
	patchMock.mockReset();
	toastSuccessMock.mockReset();
	toastErrorMock.mockReset();
	installBackend();
	document.documentElement.style.removeProperty(PRIMARY_CSS_VARIABLE);
	useAuthStore.getState().clear();
	useAuthStore.getState().setSession(session);
});

afterEach(() => {
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
});

describe("organization settings flows (task 15.2)", () => {
	it("update org details (11.1): patches the edited payload and shows success", async () => {
		setup();
		const user = userEvent.setup();

		// Details form renders once the org query resolves.
		await screen.findByText(copy.details.title);

		const nameInput = screen.getByLabelText(copy.details.fields.name);
		await user.clear(nameInput);
		await user.type(nameInput, "Acme Group");
		await user.click(screen.getByRole("button", { name: copy.details.submit }));

		// The validated payload reaches the update-organization endpoint (R11.1).
		await waitFor(() =>
			expect(patchMock).toHaveBeenCalledWith(
				organizationEndpoints.update(ORG_ID),
				expect.objectContaining({
					name: "Acme Group",
					timezone: "Asia/Kuala_Lumpur",
				}),
			),
		);

		// Success feedback (R11.1).
		await waitFor(() =>
			expect(toastSuccessMock).toHaveBeenCalledWith(copy.details.saved),
		);
		expect(toastErrorMock).not.toHaveBeenCalled();
	});

	it("update branding (11.2): patches branding and applies the color to --primary", async () => {
		setup();
		const user = userEvent.setup();

		await screen.findByText(copy.branding.title);

		const colorInput = screen.getByRole("textbox", {
			name: copy.branding.fields.primaryColor,
		});
		await user.clear(colorInput);
		await user.type(colorInput, "#1D4ED8");
		await user.click(
			screen.getByRole("button", { name: copy.branding.submit }),
		);

		// The validated payload reaches the branding endpoint (R11.2).
		await waitFor(() =>
			expect(patchMock).toHaveBeenCalledWith(
				organizationEndpoints.branding(ORG_ID),
				expect.objectContaining({ primaryColor: "#1D4ED8" }),
			),
		);

		await waitFor(() =>
			expect(toastSuccessMock).toHaveBeenCalledWith(copy.branding.saved),
		);

		// The saved brand color is injected at runtime as HSL channels (R11.2 →
		// R11.3): a hex is converted so `hsl(var(--primary))` is valid.
		await waitFor(() =>
			expect(
				document.documentElement.style.getPropertyValue(PRIMARY_CSS_VARIABLE),
			).toBe(hexToHslChannels("#1D4ED8")),
		);
		expect(toastErrorMock).not.toHaveBeenCalled();
	});

	it("update queue settings (11.6): patches the edited settings and shows success", async () => {
		setup();
		const user = userEvent.setup();

		await screen.findByText(copy.queueSettings.title);

		const maxRecallInput = screen.getByLabelText(
			copy.queueSettings.fields.maxRecall,
		);
		await user.clear(maxRecallInput);
		await user.type(maxRecallInput, "4");
		await user.click(
			screen.getByRole("button", { name: copy.queueSettings.submit }),
		);

		// The validated payload reaches the queue-settings endpoint (R11.6).
		await waitFor(() =>
			expect(patchMock).toHaveBeenCalledWith(
				organizationEndpoints.updateSettings(ORG_ID),
				expect.objectContaining({ maxRecall: 4, resetTime: "09:00" }),
			),
		);

		await waitFor(() =>
			expect(toastSuccessMock).toHaveBeenCalledWith(copy.queueSettings.saved),
		);
		expect(toastErrorMock).not.toHaveBeenCalled();
	});

	it("failure (11.8): a backend field error maps onto the matching field, no toast", async () => {
		setup();
		const user = userEvent.setup();

		await screen.findByText(copy.details.title);

		const fieldMessage = "That organization name is already in use.";
		patchMock.mockReset();
		patchMock.mockRejectedValueOnce(
			new ApiError(
				ERROR_CODES.VALIDATION_ERROR,
				"Validation failed",
				{ name: fieldMessage },
				400,
			),
		);

		await user.click(screen.getByRole("button", { name: copy.details.submit }));

		// The detail maps onto the name field as an inline error (R11.8)…
		expect(await screen.findByText(fieldMessage)).toBeInTheDocument();
		expect(screen.getByLabelText(copy.details.fields.name)).toHaveAttribute(
			"aria-invalid",
			"true",
		);

		// …and a field-mapped failure does NOT also fire a toast.
		expect(toastErrorMock).not.toHaveBeenCalled();
		expect(toastSuccessMock).not.toHaveBeenCalled();
	});

	it("failure (11.8): a field-less error surfaces a code-mapped toast", async () => {
		setup();
		const user = userEvent.setup();

		await screen.findByText(copy.details.title);

		const error = new ApiError(
			ERROR_CODES.ORG_SLUG_EXISTS,
			"Slug exists",
			undefined,
			409,
		);
		patchMock.mockReset();
		patchMock.mockRejectedValueOnce(error);

		await user.click(screen.getByRole("button", { name: copy.details.submit }));

		// No field matched → the code-mapped message is toasted (R11.8).
		await waitFor(() =>
			expect(toastErrorMock).toHaveBeenCalledWith(getErrorMessage(error)),
		);
		expect(getErrorMessage(error)).toBe(
			strings.errors[ERROR_CODES.ORG_SLUG_EXISTS],
		);
		expect(toastSuccessMock).not.toHaveBeenCalled();
	});
});
