/**
 * Counters management example tests (task 12.2, Requirements 9.2, 9.3, 9.4, 9.6).
 *
 * Behavior-focused coverage of the four counters-management flows, exercised
 * through the REAL components/hooks and the shared Zod schemas
 * (`createCounterSchema` / `updateCounterSchema`):
 *   1. Create (R9.2): a valid `CounterForm` submission POSTs to the create
 *      endpoint with the schema-validated body and invalidates `['counters', orgId]`.
 *   2. Edit (R9.3): an edit-mode `CounterForm` PATCHes the changed fields to the
 *      update endpoint and invalidates `['counters', orgId]`.
 *   3. Toggle active (R9.4): `useToggleCounter` PATCHes just `{ isActive }` over
 *      the update endpoint, reflects the new state, and invalidates the key.
 *   4. Failure (R9.6): a rejected mutation surfaces the code-mapped friendly copy
 *      (asserted via `getErrorMessage`) as an error toast.
 *
 * Mocking strategy (boundary only):
 *   - `@/lib/api/client` keeps everything real EXCEPT `apiClient.post` /
 *     `apiClient.patch`, spies we drive per test. This preserves the real
 *     `ApiError` class so the failure path maps codes exactly as in production.
 *   - `sonner` `toast.success` / `toast.error` are spies so we can assert copy.
 *   - Components/hooks run inside a `QueryClientProvider` built from the shared
 *     harness (`createTestQueryClient`, retries disabled); `invalidateQueries` is
 *     spied on that client to prove the post-success `['counters', orgId]`
 *     invalidation (R9.5 is the mechanism behind R9.2/9.3/9.4).
 *
 * These are keepable example tests — they do not modify the counters feature.
 */
import { createElement, type ReactNode } from "react";
import { QueryClientProvider, type QueryClient } from "@tanstack/react-query";
import { render, renderHook, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ERROR_CODES } from "@queuenow/shared-constants";
import type { ICounter, IService } from "@queuenow/shared-types";
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

const { postMock, patchMock, toastSuccessMock, toastErrorMock } = vi.hoisted(
	() => ({
		postMock: vi.fn(),
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
			// Drive create/edit/toggle outcomes per test; keep the rest real.
			post: postMock as unknown as typeof actual.apiClient.post,
			patch: patchMock as unknown as typeof actual.apiClient.patch,
		},
	};
});

// Imported AFTER the mocks so the components/hooks pick up the doubles.
import { ApiError } from "@/lib/api/client";
import { getErrorMessage } from "@/lib/api/error-map";
import { queryKeys } from "@/lib/api/query-keys";
import { strings } from "@/i18n";
import { createTestQueryClient } from "@/test/harness";

import { CounterForm } from "../components/CounterForm";
import { useToggleCounter } from "../api/useToggleCounter";

const ORG_ID = "org-1";
// `createCounterSchema.serviceId` must be a UUID, so the picked service uses one.
const SERVICE_ID = "11111111-1111-1111-1111-111111111111";
const COUNTER_ID = "cnt-1";

const COUNTERS_KEY = queryKeys.counters(ORG_ID);
const UPDATE_PATH = `/organizations/${ORG_ID}/counters/${COUNTER_ID}`;
const CREATE_PATH = `/organizations/${ORG_ID}/counters`;

const copy = strings.counters;

/** A single service for the form's service picker (id is a valid UUID). */
function makeService(overrides: Partial<IService> = {}): IService {
	return {
		id: SERVICE_ID,
		orgId: ORG_ID,
		name: "General",
		prefix: "A",
		isActive: true,
		sortOrder: 0,
		avgServingTime: 5,
		...overrides,
	};
}

/** A counter as returned by the create/update endpoints. */
function makeCounter(overrides: Partial<ICounter> = {}): ICounter {
	return {
		id: COUNTER_ID,
		orgId: ORG_ID,
		serviceId: SERVICE_ID,
		name: "Counter 1",
		isActive: true,
		...overrides,
	};
}

interface Harness {
	queryClient: QueryClient;
	/** Spy on the success-path `['counters', orgId]` invalidation. */
	invalidateSpy: MockInstance;
	wrapper: ({ children }: { children: ReactNode }) => ReactNode;
}

/** Wire a provider + invalidation spy for a test. */
function setup(): Harness {
	const queryClient = createTestQueryClient();
	const invalidateSpy = vi
		.spyOn(queryClient, "invalidateQueries")
		.mockReturnValue(Promise.resolve());

	const wrapper = ({ children }: { children: ReactNode }): ReactNode =>
		createElement(QueryClientProvider, { client: queryClient }, children);

	return { queryClient, invalidateSpy, wrapper };
}

beforeAll(() => {
	// Deterministic base URL so the real client module imports cleanly.
	vi.stubEnv("VITE_API_URL", "http://localhost:4000/api/v1");
	vi.stubEnv("VITE_WS_URL", "http://localhost:4000");
});

beforeEach(() => {
	postMock.mockReset();
	patchMock.mockReset();
	toastSuccessMock.mockReset();
	toastErrorMock.mockReset();
});

afterEach(() => {
	vi.unstubAllGlobals();
});

describe("counters management flows (task 12.2)", () => {
	it("create (R9.2): a valid form submission POSTs the schema body and invalidates the counters key", async () => {
		const { invalidateSpy, wrapper } = setup();
		const onDone = vi.fn();
		postMock.mockResolvedValueOnce({ data: makeCounter() });

		render(
			createElement(CounterForm, {
				orgId: ORG_ID,
				services: [makeService()],
				onDone,
				onCancel: vi.fn(),
			}),
			{ wrapper },
		);

		await userEvent.type(screen.getByLabelText(copy.fields.name), "Counter 1");
		await userEvent.click(
			screen.getByRole("button", { name: copy.submitCreate }),
		);

		// The create endpoint receives the schema-validated body (serviceId is the
		// pre-selected UUID, isActive defaults to true).
		await waitFor(() =>
			expect(postMock).toHaveBeenCalledWith(CREATE_PATH, {
				serviceId: SERVICE_ID,
				name: "Counter 1",
				isActive: true,
			}),
		);

		await waitFor(() => expect(onDone).toHaveBeenCalledTimes(1));
		expect(toastSuccessMock).toHaveBeenCalledWith(copy.createSuccess);
		// R9.5 mechanism: the counters list is invalidated on success.
		expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: COUNTERS_KEY });
	});

	it("edit (R9.3): an edit submission PATCHes the changed fields and invalidates the counters key", async () => {
		const { invalidateSpy, wrapper } = setup();
		const onDone = vi.fn();
		patchMock.mockResolvedValueOnce({
			data: makeCounter({ name: "Renamed counter" }),
		});

		render(
			createElement(CounterForm, {
				orgId: ORG_ID,
				services: [makeService()],
				counter: makeCounter({ name: "Counter 1" }),
				onDone,
				onCancel: vi.fn(),
			}),
			{ wrapper },
		);

		const nameField = screen.getByLabelText(copy.fields.name);
		await userEvent.clear(nameField);
		await userEvent.type(nameField, "Renamed counter");
		await userEvent.click(
			screen.getByRole("button", { name: copy.submitEdit }),
		);

		// The update endpoint receives the edited name (partial-schema body).
		await waitFor(() => expect(patchMock).toHaveBeenCalledTimes(1));
		const [calledPath, calledBody] = patchMock.mock.calls[0] as [
			string,
			Record<string, unknown>,
		];
		expect(calledPath).toBe(UPDATE_PATH);
		expect(calledBody).toMatchObject({ name: "Renamed counter" });

		await waitFor(() => expect(onDone).toHaveBeenCalledTimes(1));
		expect(toastSuccessMock).toHaveBeenCalledWith(copy.updateSuccess);
		expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: COUNTERS_KEY });
	});

	it("toggle active (R9.4): PATCHes just { isActive }, reflects the new state, and invalidates the key", async () => {
		const { invalidateSpy, wrapper } = setup();
		patchMock.mockResolvedValueOnce({ data: makeCounter({ isActive: false }) });

		const { result } = renderHook(() => useToggleCounter({ orgId: ORG_ID }), {
			wrapper,
		});

		result.current.mutate({ id: COUNTER_ID, isActive: false });

		await waitFor(() => expect(result.current.isSuccess).toBe(true));
		// Toggle is a thin isActive-only PATCH over the update endpoint.
		expect(patchMock).toHaveBeenCalledWith(UPDATE_PATH, { isActive: false });
		// The mutation result reflects the new (deactivated) state.
		expect(result.current.data?.isActive).toBe(false);
		expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: COUNTERS_KEY });
	});

	it("failure (R9.6): a rejected create surfaces the code-mapped copy as an error toast", async () => {
		const { invalidateSpy, wrapper } = setup();
		const onDone = vi.fn();
		// No `details`, so the form falls back to a code-mapped toast (not a field error).
		const error = new ApiError(
			ERROR_CODES.VALIDATION_ERROR,
			"raw backend message that must never surface",
			undefined,
			400,
		);
		postMock.mockRejectedValueOnce(error);

		render(
			createElement(CounterForm, {
				orgId: ORG_ID,
				services: [makeService()],
				onDone,
				onCancel: vi.fn(),
			}),
			{ wrapper },
		);

		await userEvent.type(screen.getByLabelText(copy.fields.name), "Counter 1");
		await userEvent.click(
			screen.getByRole("button", { name: copy.submitCreate }),
		);

		// The friendly, code-mapped copy is shown — never the raw backend message.
		await waitFor(() =>
			expect(toastErrorMock).toHaveBeenCalledWith(getErrorMessage(error)),
		);
		expect(getErrorMessage(error)).toBe(
			strings.errors[ERROR_CODES.VALIDATION_ERROR],
		);
		expect(toastErrorMock).not.toHaveBeenCalledWith(error.message);
		// A failed mutation neither closes the form nor invalidates the list.
		expect(onDone).not.toHaveBeenCalled();
		expect(invalidateSpy).not.toHaveBeenCalled();
	});
});
