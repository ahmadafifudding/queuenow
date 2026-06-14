/**
 * Services management example tests (task 11.2, Requirements 8.2, 8.3, 8.4, 8.6).
 *
 * Behavior-focused coverage of the four services flows, driven through the real
 * `ServicesView` surface (which wires `ServiceForm`, `ServicesList`, and the
 * create/update/toggle hooks) so the assertions reflect what a user actually
 * triggers:
 *   - Create (8.2): fill the create form → `apiClient.post` is called with the
 *     create payload; the `['services', orgId]` key is invalidated; the success
 *     toast is shown; the new row appears after the refetch.
 *   - Edit (8.3): submit the edit form → `apiClient.patch` is called with the
 *     changed fields; invalidation + success toast; the row reflects the update.
 *   - Toggle (8.4): toggling active → `apiClient.patch` with `{ isActive }`;
 *     invalidation + success toast; the row reflects the new state post-refetch.
 *   - Failure / field errors (8.6): a rejected `ApiError` carrying
 *     `error.details` maps onto the matching form field as an inline error (no
 *     toast); a field-less `ApiError` surfaces a code-mapped toast
 *     (`getErrorMessage`).
 *
 * Mocking strategy (boundary only):
 *   - `@/lib/api/client` keeps everything real EXCEPT `apiClient.get/post/patch`,
 *     backed by a tiny in-memory services "backend" so query invalidation +
 *     refetch genuinely reflect mutations. The real `ApiError` class is
 *     preserved so the error paths flow exactly as in production.
 *   - `sonner` `toast.success` / `toast.error` are spies.
 *   - Components run inside a `QueryClientProvider` from the test harness
 *     (`createTestQueryClient`, retries disabled). `invalidateQueries` is spied
 *     (calling through) to prove the `['services', orgId]` reconcile on success.
 *   - The active org is seeded into `useAuthStore` (the view reads `orgId` there).
 *
 * These are keepable example tests — they do not modify the services feature.
 */
import { QueryClientProvider, type QueryClient } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ERROR_CODES } from "@queuenow/shared-constants";
import {
	UserRoleType,
	type IService,
	type ILoginResponse,
} from "@queuenow/shared-types";
import type {
	CreateServiceInput,
	UpdateServiceInput,
} from "@queuenow/shared-validation";
import {
	afterEach,
	beforeAll,
	beforeEach,
	describe,
	expect,
	it,
	vi,
	type MockInstance,
} from "vitest";

const { getMock, postMock, patchMock, toastSuccessMock, toastErrorMock } =
	vi.hoisted(() => ({
		getMock: vi.fn(),
		postMock: vi.fn(),
		patchMock: vi.fn(),
		toastSuccessMock: vi.fn(),
		toastErrorMock: vi.fn(),
	}));

vi.mock("sonner", () => ({
	toast: { success: toastSuccessMock, error: toastErrorMock },
}));

vi.mock("@/lib/api/client", async (importActual) => {
	const actual = await importActual<typeof import("@/lib/api/client")>();
	return {
		...actual,
		apiClient: {
			...actual.apiClient,
			// Drive list/create/update outcomes per test; keep the rest real.
			get: getMock as unknown as typeof actual.apiClient.get,
			post: postMock as unknown as typeof actual.apiClient.post,
			patch: patchMock as unknown as typeof actual.apiClient.patch,
		},
	};
});

// Imported AFTER the mocks so the view/hooks pick up the doubles.
import { ApiError } from "@/lib/api/client";
import { getErrorMessage } from "@/lib/api/error-map";
import { queryKeys } from "@/lib/api/query-keys";
import { strings } from "@/i18n";
import { createTestQueryClient } from "@/test/harness";
import { useAuthStore } from "@/features/auth";

import { serviceEndpoints } from "../api/endpoints";
import { ServicesView } from "../components/ServicesView";

const ORG_ID = "o1";
const GENERAL_ID = "svc-general";

const copy = strings.services;

/** A session whose active org is the one the view lists services for. */
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

/** A single seeded, active service the edit/toggle rows act on. */
function makeGeneral(): IService {
	return {
		id: GENERAL_ID,
		orgId: ORG_ID,
		name: "General",
		prefix: "GEN",
		isActive: true,
		sortOrder: 0,
		avgServingTime: 5,
		maxQueuePerDay: null,
	};
}

/**
 * A tiny in-memory services backend so invalidation + refetch reflect mutations
 * exactly like production (the view re-reads the list after each success).
 */
let services: IService[] = [];

function installBackend(): void {
	services = [makeGeneral()];

	getMock.mockImplementation(async () => ({
		data: services.map((service) => ({ ...service })),
	}));

	postMock.mockImplementation(async (_path: string, body?: unknown) => {
		const input = body as CreateServiceInput;
		const created: IService = {
			id: "svc-created",
			orgId: ORG_ID,
			name: input.name,
			prefix: input.prefix,
			isActive: input.isActive ?? true,
			sortOrder: input.sortOrder ?? 0,
			avgServingTime: input.avgServingTime ?? 5,
			maxQueuePerDay: input.maxQueuePerDay ?? null,
		};
		services.push(created);
		return { data: created };
	});

	patchMock.mockImplementation(async (path: string, body?: unknown) => {
		const id = path.split("/").pop() ?? "";
		const existing = services.find((service) => service.id === id);
		if (existing === undefined) {
			throw new ApiError("SERVICE_NOT_FOUND", "missing", undefined, 404);
		}
		const next = {
			...existing,
			...(body as UpdateServiceInput),
		} as IService;
		services = services.map((service) => (service.id === id ? next : service));
		return { data: next };
	});
}

interface Harness {
	queryClient: QueryClient;
	/** Spy on the services-key invalidation that reconciles after each success. */
	invalidateSpy: MockInstance;
}

/** Render the services view inside a fresh, retry-disabled QueryClient. */
function setup(): Harness {
	const queryClient = createTestQueryClient();
	const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

	render(
		<QueryClientProvider client={queryClient}>
			<ServicesView />
		</QueryClientProvider>,
	);

	return { queryClient, invalidateSpy };
}

beforeAll(() => {
	// Deterministic base URL so the real client module imports cleanly.
	vi.stubEnv("VITE_API_URL", "http://localhost:4000/api/v1");
	vi.stubEnv("VITE_WS_URL", "http://localhost:4000");
});

beforeEach(() => {
	getMock.mockReset();
	postMock.mockReset();
	patchMock.mockReset();
	toastSuccessMock.mockReset();
	toastErrorMock.mockReset();
	installBackend();
	useAuthStore.getState().clear();
	useAuthStore.getState().setSession(session);
});

afterEach(() => {
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
});

describe("services flows (task 11.2)", () => {
	it("create (8.2): posts the create payload, invalidates the services key, and shows success", async () => {
		const { invalidateSpy } = setup();
		const user = userEvent.setup();

		// List loads first so the create affordance is present.
		await screen.findByText("General");
		await user.click(screen.getByRole("button", { name: copy.actions.create }));

		await user.type(screen.getByLabelText(copy.form.fields.name), "Walk-in");
		await user.type(screen.getByLabelText(copy.form.fields.prefix), "WLK");
		await user.click(
			screen.getByRole("button", { name: copy.form.submitCreate }),
		);

		// The validated create payload reaches the API client (R8.2).
		await waitFor(() =>
			expect(postMock).toHaveBeenCalledWith(
				serviceEndpoints.list(ORG_ID),
				expect.objectContaining({
					name: "Walk-in",
					prefix: "WLK",
					isActive: true,
					sortOrder: 0,
					avgServingTime: 5,
				}),
			),
		);

		// Success feedback + services-key invalidation (R8.5).
		await waitFor(() =>
			expect(toastSuccessMock).toHaveBeenCalledWith(copy.form.createSuccess),
		);
		expect(invalidateSpy).toHaveBeenCalledWith({
			queryKey: queryKeys.services(ORG_ID),
		});

		// Reflected after the post-invalidation refetch.
		expect(await screen.findByText("Walk-in")).toBeInTheDocument();
		expect(toastErrorMock).not.toHaveBeenCalled();
	});

	it("edit (8.3): patches the changed fields, invalidates, and shows success", async () => {
		const { invalidateSpy } = setup();
		const user = userEvent.setup();

		await screen.findByText("General");
		await user.click(screen.getByRole("button", { name: copy.actions.edit }));

		const nameInput = screen.getByLabelText(copy.form.fields.name);
		await user.clear(nameInput);
		await user.type(nameInput, "General Updated");
		await user.click(
			screen.getByRole("button", { name: copy.form.submitEdit }),
		);

		// The changed fields reach the update endpoint (R8.3).
		await waitFor(() =>
			expect(patchMock).toHaveBeenCalledWith(
				serviceEndpoints.detail(ORG_ID, GENERAL_ID),
				expect.objectContaining({ name: "General Updated" }),
			),
		);

		await waitFor(() =>
			expect(toastSuccessMock).toHaveBeenCalledWith(copy.form.editSuccess),
		);
		expect(invalidateSpy).toHaveBeenCalledWith({
			queryKey: queryKeys.services(ORG_ID),
		});

		expect(await screen.findByText("General Updated")).toBeInTheDocument();
		expect(toastErrorMock).not.toHaveBeenCalled();
	});

	it("toggle (8.4): patches { isActive: false }, invalidates, and reflects the new state", async () => {
		const { invalidateSpy } = setup();
		const user = userEvent.setup();

		await screen.findByText("General");
		// Active service → the toggle reads "Deactivate".
		await user.click(
			screen.getByRole("button", { name: copy.actions.deactivate }),
		);

		// Toggling active is a partial update of `isActive` (R8.4, R8.5).
		await waitFor(() =>
			expect(patchMock).toHaveBeenCalledWith(
				serviceEndpoints.detail(ORG_ID, GENERAL_ID),
				{ isActive: false },
			),
		);

		await waitFor(() =>
			expect(toastSuccessMock).toHaveBeenCalledWith(
				copy.form.deactivateSuccess,
			),
		);
		expect(invalidateSpy).toHaveBeenCalledWith({
			queryKey: queryKeys.services(ORG_ID),
		});

		// Post-refetch the row reflects the new state (label + action flip).
		expect(
			await screen.findByRole("button", { name: copy.actions.activate }),
		).toBeInTheDocument();
		expect(screen.getByText(copy.inactiveLabel)).toBeInTheDocument();
		expect(toastErrorMock).not.toHaveBeenCalled();
	});

	it("failure (8.6): backend field error maps onto the matching field, no toast", async () => {
		setup();
		const user = userEvent.setup();

		const fieldMessage = "That service prefix is already in use.";
		postMock.mockReset();
		postMock.mockRejectedValueOnce(
			new ApiError(
				ERROR_CODES.VALIDATION_ERROR,
				"Validation failed",
				{ prefix: fieldMessage },
				400,
			),
		);

		await screen.findByText("General");
		await user.click(screen.getByRole("button", { name: copy.actions.create }));
		await user.type(screen.getByLabelText(copy.form.fields.name), "Duplicate");
		await user.type(screen.getByLabelText(copy.form.fields.prefix), "GEN");
		await user.click(
			screen.getByRole("button", { name: copy.form.submitCreate }),
		);

		// The detail maps onto the prefix field as an inline error (R8.6)…
		expect(await screen.findByText(fieldMessage)).toBeInTheDocument();
		const prefixInput = screen.getByLabelText(copy.form.fields.prefix);
		expect(prefixInput).toHaveAttribute("aria-invalid", "true");

		// …and a field-mapped failure does NOT also fire a toast.
		expect(toastErrorMock).not.toHaveBeenCalled();
		expect(toastSuccessMock).not.toHaveBeenCalled();
	});

	it("failure (8.6): a field-less error surfaces a code-mapped toast", async () => {
		setup();
		const user = userEvent.setup();

		const error = new ApiError(
			ERROR_CODES.SERVICE_PREFIX_EXISTS,
			"Prefix exists",
			undefined,
			409,
		);
		postMock.mockReset();
		postMock.mockRejectedValueOnce(error);

		await screen.findByText("General");
		await user.click(screen.getByRole("button", { name: copy.actions.create }));
		await user.type(screen.getByLabelText(copy.form.fields.name), "Walk-in");
		await user.type(screen.getByLabelText(copy.form.fields.prefix), "WLK");
		await user.click(
			screen.getByRole("button", { name: copy.form.submitCreate }),
		);

		// No field matched → the code-mapped message is toasted (R8.6).
		await waitFor(() =>
			expect(toastErrorMock).toHaveBeenCalledWith(getErrorMessage(error)),
		);
		expect(getErrorMessage(error)).toBe(
			strings.errors[ERROR_CODES.SERVICE_PREFIX_EXISTS],
		);
		expect(toastSuccessMock).not.toHaveBeenCalled();
	});
});
