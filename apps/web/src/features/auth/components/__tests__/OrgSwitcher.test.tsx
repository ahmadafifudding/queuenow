/**
 * OrgSwitcher component tests (task 8.4).
 *
 * Behavior-focused coverage of the AppShell organization switcher, mocking the
 * query/mutation hooks at the boundary (no real backend). The real auth store is
 * used and seeded per test; `getErrorMessage` and the i18n `strings` stay real so
 * assertions match the copy the user actually sees.
 *
 * Coverage:
 *   - R5.1  renders one entry per organization (multi-org list).
 *   - R5.3  marks exactly the active entry (the one matching the auth store's
 *           organization.id) with the selected marker (aria-checked).
 *   - R5.11 a single membership renders a static label — no menu/trigger.
 *   - R5.5  selecting the already-active organization performs no switch.
 *   - R5.4  selecting a non-active organization calls the mutation with its orgId.
 *   - R5.6  while a switch is in flight the trigger shows a pending state, is
 *           disabled, and selections are ignored (mutate not called).
 *   - R5.2  a failed list fetch surfaces the list-fetch-failed message, renders no
 *           menu, and leaves the active organization unchanged.
 *   - R5.12 a failed switch surfaces the `error.code`-mapped message while leaving
 *           the active organization unchanged.
 *
 * Mocking strategy:
 *   - `@/features/auth/api/useOrganizations` and `@/features/auth/api/useSwitchOrganization`
 *     are replaced with vi.fn() doubles driven per test via small result builders.
 *   - The real `useAuthStore` is seeded in `beforeEach`; the component derives the
 *     active entry from `organization.id`.
 */
import type { UseMutationResult, UseQueryResult } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
	UserRoleType,
	type ILoginResponse,
	type OrganizationMembership,
} from "@queuenow/shared-types";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ApiError } from "@/lib/api/client";

const { useOrganizationsMock, useSwitchOrganizationMock, mutateMock } =
	vi.hoisted(() => ({
		useOrganizationsMock: vi.fn(),
		useSwitchOrganizationMock: vi.fn(),
		mutateMock: vi.fn(),
	}));

vi.mock("@/features/auth/api/useOrganizations", () => ({
	useOrganizations: useOrganizationsMock,
}));

vi.mock("@/features/auth/api/useSwitchOrganization", () => ({
	useSwitchOrganization: useSwitchOrganizationMock,
}));

// Imported AFTER the mocks above so the component picks up the doubles.
import { OrgSwitcher } from "../OrgSwitcher";
import { useAuthStore } from "../../stores/auth-store";
import { getErrorMessage } from "@/lib/api/error-map";
import { strings } from "@/i18n";

/** The user's currently-active organization (seeded into the auth store). */
const ORG_A: OrganizationMembership = {
	id: "org-a",
	name: "Acme HQ",
	slug: "acme-hq",
	isActive: true,
	role: UserRoleType.OWNER,
	active: true,
};

/** A second, non-active organization the user can switch to. */
const ORG_B: OrganizationMembership = {
	id: "org-b",
	name: "Acme Downtown",
	slug: "acme-downtown",
	isActive: true,
	role: UserRoleType.ADMIN,
	active: false,
};

/** Build a `useOrganizations` query result with deterministic defaults. */
function buildOrgQuery(
	overrides: Partial<UseQueryResult<OrganizationMembership[], ApiError>>,
): UseQueryResult<OrganizationMembership[], ApiError> {
	return {
		data: undefined,
		isError: false,
		isLoading: false,
		...overrides,
	} as unknown as UseQueryResult<OrganizationMembership[], ApiError>;
}

/** Build a `useSwitchOrganization` mutation result with deterministic defaults. */
function buildSwitch(
	overrides: Partial<UseMutationResult<ILoginResponse, ApiError, string>>,
): UseMutationResult<ILoginResponse, ApiError, string> {
	return {
		mutate: mutateMock,
		isPending: false,
		isError: false,
		error: null,
		...overrides,
	} as unknown as UseMutationResult<ILoginResponse, ApiError, string>;
}

beforeEach(() => {
	useOrganizationsMock.mockReset();
	useSwitchOrganizationMock.mockReset();
	mutateMock.mockReset();

	// Seed the active organization the switcher derives its selected marker from.
	useAuthStore.setState({
		organization: {
			id: ORG_A.id,
			name: ORG_A.name,
			slug: ORG_A.slug,
			role: ORG_A.role,
		},
		status: "authenticated",
	});

	// Sensible defaults; individual tests override as needed.
	useOrganizationsMock.mockReturnValue(buildOrgQuery({ data: [ORG_A, ORG_B] }));
	useSwitchOrganizationMock.mockReturnValue(buildSwitch({}));
});

afterEach(() => {
	useAuthStore.getState().clear();
});

describe("OrgSwitcher (task 8.4)", () => {
	it("R5.1: renders one entry per organization", async () => {
		const user = userEvent.setup();
		render(<OrgSwitcher />);

		// Open the menu (the only button before opening is the trigger).
		await user.click(screen.getByRole("button"));

		const items = screen.getAllByRole("menuitemradio");
		expect(items).toHaveLength(2);
		expect(
			screen.getByRole("menuitemradio", { name: /Acme HQ/ }),
		).toBeInTheDocument();
		expect(
			screen.getByRole("menuitemradio", { name: /Acme Downtown/ }),
		).toBeInTheDocument();
	});

	it("R5.3: marks exactly the active entry with the selected marker", async () => {
		const user = userEvent.setup();
		render(<OrgSwitcher />);

		await user.click(screen.getByRole("button"));

		const items = screen.getAllByRole("menuitemradio");
		const checked = items.filter(
			(item) => item.getAttribute("aria-checked") === "true",
		);
		expect(checked).toHaveLength(1);
		expect(checked[0]).toHaveTextContent(ORG_A.name);
	});

	it("R5.11: renders a static label (no menu) for a single membership", () => {
		useOrganizationsMock.mockReturnValue(buildOrgQuery({ data: [ORG_A] }));

		render(<OrgSwitcher />);

		// No interactive trigger/menu — just the org name as a static label.
		expect(screen.queryByRole("button")).toBeNull();
		expect(screen.getByText(ORG_A.name)).toBeInTheDocument();
	});

	it("R5.5: selecting the already-active organization performs no switch", async () => {
		const user = userEvent.setup();
		render(<OrgSwitcher />);

		await user.click(screen.getByRole("button"));
		await user.click(screen.getByRole("menuitemradio", { name: /Acme HQ/ }));

		expect(mutateMock).not.toHaveBeenCalled();
	});

	it("R5.4: selecting a non-active organization calls the mutation with its orgId", async () => {
		const user = userEvent.setup();
		render(<OrgSwitcher />);

		await user.click(screen.getByRole("button"));
		await user.click(
			screen.getByRole("menuitemradio", { name: /Acme Downtown/ }),
		);

		expect(mutateMock).toHaveBeenCalledTimes(1);
		expect(mutateMock).toHaveBeenCalledWith(ORG_B.id);
	});

	it("R5.6: shows a pending, disabled state and ignores selections while switching", async () => {
		useSwitchOrganizationMock.mockReturnValue(buildSwitch({ isPending: true }));
		const user = userEvent.setup();

		render(<OrgSwitcher />);

		const trigger = screen.getByRole("button");
		expect(trigger).toBeDisabled();
		expect(trigger).toHaveTextContent(strings.orgSwitcher.pending);

		// The disabled trigger cannot open the menu, so no selection is possible.
		await user.click(trigger);
		expect(screen.queryAllByRole("menuitemradio")).toHaveLength(0);
		expect(mutateMock).not.toHaveBeenCalled();
	});

	it("R5.2: a failed list fetch surfaces the failure, renders no menu, and leaves the active org unchanged", () => {
		useOrganizationsMock.mockReturnValue(buildOrgQuery({ isError: true }));

		render(<OrgSwitcher />);

		expect(
			screen.getByText(strings.orgSwitcher.listFetchFailed),
		).toBeInTheDocument();
		expect(screen.queryByRole("button")).toBeNull();
		// State unchanged: the active organization is still ORG_A.
		expect(useAuthStore.getState().organization?.id).toBe(ORG_A.id);
		expect(mutateMock).not.toHaveBeenCalled();
	});

	it("R5.12: a failed switch surfaces the error.code message and leaves the active org unchanged", () => {
		const error = { code: "ORG_INACTIVE" } as unknown as ApiError;
		useSwitchOrganizationMock.mockReturnValue(
			buildSwitch({ isError: true, error }),
		);

		render(<OrgSwitcher />);

		const alert = screen.getByRole("alert");
		expect(alert).toHaveTextContent(getErrorMessage(error));
		// The mapped copy for ORG_INACTIVE, not a raw backend message.
		expect(alert).toHaveTextContent(strings.errors.ORG_INACTIVE);
		// State unchanged: the active organization is still ORG_A.
		expect(useAuthStore.getState().organization?.id).toBe(ORG_A.id);
	});
});
