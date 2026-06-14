/**
 * Staff invite-flow example tests (task 13.3, Requirements 10.3, 10.5).
 *
 * Behavior-focused coverage of the staff invitation flow, driven through the
 * real `InviteStaffForm` + `useInviteStaff` hook (no re-implementation of the
 * component under test):
 *   1. Invite success (R10.3): a valid `inviteStaffSchema` payload (email +
 *      role) is POSTed to the invite endpoint; on success the visible staff page
 *      query key `['staff', orgId, page]` is invalidated and success feedback is
 *      shown, and the form resets.
 *   2. Invite failure (R10.5): when the API rejects with an `ApiError`,
 *      a) a non-field error surfaces the code-mapped copy via `getErrorMessage`
 *         as a toast, and the staff list is NOT invalidated; and
 *      b) `error.details` field errors map onto the matching form field (email)
 *         as an inline message, without a general toast.
 *
 * Mocking strategy (boundary only):
 *   - `@/lib/api/client` keeps everything real EXCEPT `apiClient.post`, a spy we
 *     drive per test. This preserves the real `ApiError` class so the code/
 *     details flow exactly as in production.
 *   - `sonner` `toast.success` / `toast.error` are spies so we can assert the
 *     surfaced copy.
 *   - The form renders inside a `QueryClientProvider` built from the test
 *     harness (`createTestQueryClient`, retries disabled). `invalidateQueries`
 *     on that client is spied to prove the page-scoped invalidation.
 *
 * These are keepable example tests — they do not modify the staff feature.
 */
import type { ReactNode } from "react";
import { QueryClientProvider, type QueryClient } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ERROR_CODES } from "@queuenow/shared-constants";
import { UserRoleType } from "@queuenow/shared-types";
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

const { postMock, toastSuccessMock, toastErrorMock } = vi.hoisted(() => ({
	postMock: vi.fn(),
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
			// Drive the invite outcome per test; keep the rest of the client real.
			post: postMock as unknown as typeof actual.apiClient.post,
		},
	};
});

// Imported AFTER the mocks so the component/hook pick up the doubles.
import { ApiError } from "@/lib/api/client";
import { getErrorMessage } from "@/lib/api/error-map";
import { queryKeys } from "@/lib/api/query-keys";
import { useAuthStore } from "@/features/auth/stores/auth-store";
import { strings } from "@/i18n";
import { createTestQueryClient } from "@/test/harness";

import { InviteStaffForm } from "../components/InviteStaffForm";
import type { StaffInvitation } from "../types";

const ORG_ID = "org-1";
const PAGE = 2;
const copy = strings.staff.invite;

/** Mount the invite form inside a provider and expose the client + its spy. */
function setup(): {
	queryClient: QueryClient;
	invalidateSpy: MockInstance;
} {
	const queryClient = createTestQueryClient();
	const invalidateSpy = vi
		.spyOn(queryClient, "invalidateQueries")
		.mockReturnValue(Promise.resolve());

	const wrapper = ({ children }: { children: ReactNode }): ReactNode => (
		<QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
	);

	render(<InviteStaffForm orgId={ORG_ID} page={PAGE} />, { wrapper });

	return { queryClient, invalidateSpy };
}

/** Fill the invite form with a valid `inviteStaffSchema` payload and submit. */
async function fillAndSubmit(
	user: ReturnType<typeof userEvent.setup>,
	options: { email: string; role: "ADMIN" | "STAFF" },
): Promise<void> {
	await user.type(screen.getByLabelText(copy.emailLabel), options.email);
	await user.selectOptions(screen.getByLabelText(copy.roleLabel), options.role);
	await user.click(screen.getByRole("button", { name: copy.submit }));
}

beforeAll(() => {
	// Deterministic base URL so the real client module imports cleanly.
	vi.stubEnv("VITE_API_URL", "http://localhost:4000/api/v1");
	vi.stubEnv("VITE_WS_URL", "http://localhost:4000");
});

beforeEach(() => {
	postMock.mockReset();
	toastSuccessMock.mockReset();
	toastErrorMock.mockReset();
	useAuthStore.getState().clear();
});

afterEach(() => {
	vi.unstubAllGlobals();
});

describe("staff invite flow (task 13.3)", () => {
	it("invite success (R10.3): posts the payload, invalidates the visible page, shows success, resets", async () => {
		const user = userEvent.setup();
		const { invalidateSpy } = setup();

		const invitation: StaffInvitation = {
			id: "inv-1",
			email: "new.hire@acme.test",
			role: UserRoleType.ADMIN,
		};
		postMock.mockResolvedValueOnce({ data: invitation });

		await fillAndSubmit(user, { email: invitation.email, role: "ADMIN" });

		// The invite endpoint is called with the schema-validated payload.
		await waitFor(() =>
			expect(postMock).toHaveBeenCalledWith(
				`/organizations/${ORG_ID}/staff/invite`,
				expect.objectContaining({ email: invitation.email, role: "ADMIN" }),
			),
		);

		// On success the EXACT visible page key is invalidated (R10.4 backing R10.3).
		await waitFor(() =>
			expect(invalidateSpy).toHaveBeenCalledWith({
				queryKey: queryKeys.staff(ORG_ID, PAGE),
			}),
		);

		// Success feedback shown; no error toast.
		expect(toastSuccessMock).toHaveBeenCalledWith(copy.success);
		expect(toastErrorMock).not.toHaveBeenCalled();

		// The form resets so the next invite starts clean.
		await waitFor(() =>
			expect(screen.getByLabelText(copy.emailLabel)).toHaveValue(""),
		);
	});

	it("invite failure (R10.5): a non-field ApiError surfaces the code-mapped toast and does not invalidate", async () => {
		const user = userEvent.setup();
		const { invalidateSpy } = setup();

		const error = new ApiError(
			ERROR_CODES.STAFF_ALREADY_MEMBER,
			"already a member",
			undefined,
			409,
		);
		postMock.mockRejectedValueOnce(error);

		await fillAndSubmit(user, { email: "existing@acme.test", role: "STAFF" });

		// The friendly, code-mapped copy is toasted (never the raw backend message).
		const expectedMessage = strings.errors[ERROR_CODES.STAFF_ALREADY_MEMBER];
		await waitFor(() =>
			expect(toastErrorMock).toHaveBeenCalledWith(expectedMessage),
		);
		expect(getErrorMessage(error)).toBe(expectedMessage);

		// A failed invite must not invalidate the staff list, and shows no success.
		expect(invalidateSpy).not.toHaveBeenCalled();
		expect(toastSuccessMock).not.toHaveBeenCalled();
	});

	it("invite failure (R10.5): error.details map onto the matching field as an inline error (no general toast)", async () => {
		const user = userEvent.setup();
		const { invalidateSpy } = setup();

		const fieldMessage = "This email already has a pending invitation.";
		const error = new ApiError(
			ERROR_CODES.STAFF_INVITATION_PENDING,
			"pending invite",
			{ email: fieldMessage },
			409,
		);
		postMock.mockRejectedValueOnce(error);

		await fillAndSubmit(user, { email: "pending@acme.test", role: "STAFF" });

		// The detail maps onto the email field as an inline message…
		expect(await screen.findByText(fieldMessage)).toBeInTheDocument();
		const emailInput = screen.getByLabelText(copy.emailLabel);
		expect(emailInput).toHaveAttribute("aria-invalid", "true");

		// …and because every detail mapped to a field, no general toast is shown.
		expect(toastErrorMock).not.toHaveBeenCalled();
		expect(invalidateSpy).not.toHaveBeenCalled();
	});
});
