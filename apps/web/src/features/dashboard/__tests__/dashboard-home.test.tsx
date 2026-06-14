/**
 * Dashboard home example tests.
 *
 * Behavior-focused coverage of the summary view. `useOrgStats` is mocked at the
 * module boundary so each test controls the query result; `@tanstack/react-router`
 * `Link` is stubbed to a plain anchor so no RouterProvider is needed. The auth
 * store is seeded so the view has an active org.
 */
import type { ReactNode } from "react";
import type { UseQueryResult } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { UserRoleType, type ILoginResponse } from "@queuenow/shared-types";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "@/lib/api/client";
import { strings } from "@/i18n";
import { useAuthStore } from "@/features/auth";

import type { OrgStats } from "../types";

const { useOrgStatsMock } = vi.hoisted(() => ({ useOrgStatsMock: vi.fn() }));

vi.mock("../api/useOrgStats", () => ({
	useOrgStats: useOrgStatsMock,
	ORG_STATS_REFETCH_MS: 15_000,
}));

vi.mock("@tanstack/react-router", async (importActual) => {
	const actual = await importActual<typeof import("@tanstack/react-router")>();
	const { createElement } = await import("react");
	return {
		...actual,
		Link: (props: { to: string; children?: ReactNode }) =>
			createElement("a", { href: props.to }, props.children),
	};
});

// Imported AFTER the mocks so the view picks up the doubles.
import { DashboardHome } from "../components/DashboardHome";

const copy = strings.dashboard;

const session: ILoginResponse = {
	user: { id: "u1", email: "owner@acme.test", fullName: "Olwen Owner", avatarUrl: null },
	organization: { id: "o1", name: "Acme", slug: "acme", role: UserRoleType.OWNER },
	tokens: { accessToken: "a", refreshToken: "r" },
};

function asQueryResult(
	partial: Partial<UseQueryResult<OrgStats, ApiError>>,
): UseQueryResult<OrgStats, ApiError> {
	return {
		isLoading: false,
		isError: false,
		error: null,
		data: undefined,
		refetch: vi.fn(),
		...partial,
	} as UseQueryResult<OrgStats, ApiError>;
}

beforeEach(() => {
	useAuthStore.getState().clear();
	useAuthStore.getState().setSession(session);
});

afterEach(() => {
	useOrgStatsMock.mockReset();
	useAuthStore.getState().clear();
});

describe("DashboardHome", () => {
	it("renders today's stat counts", () => {
		useOrgStatsMock.mockReturnValue(
			asQueryResult({
				data: { waiting: 4, serving: 2, completed: 11, skipped: 1, total: 18 },
			}),
		);

		render(<DashboardHome />);

		expect(screen.getByText(copy.stats.waiting)).toBeInTheDocument();
		expect(screen.getByText("4")).toBeInTheDocument();
		expect(screen.getByText("11")).toBeInTheDocument();
		expect(screen.getByText("18")).toBeInTheDocument();
		// Greets the signed-in user.
		expect(screen.getByText("Welcome back, Olwen Owner.")).toBeInTheDocument();
		// Shortcut to the queue panel.
		expect(
			screen.getByRole("link", { name: copy.goToQueue }),
		).toHaveAttribute("href", "/queue");
	});

	it("shows a code-mapped error state when stats fail to load", () => {
		const error = new ApiError("INTERNAL_ERROR", "boom", undefined, 500);
		useOrgStatsMock.mockReturnValue(asQueryResult({ isError: true, error }));

		render(<DashboardHome />);

		expect(screen.getByRole("alert")).toBeInTheDocument();
		expect(screen.getByText(strings.errors.INTERNAL_ERROR)).toBeInTheDocument();
	});
});
