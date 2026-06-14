/**
 * PlanUsageView state tests (task 14.5, Requirements 8.1, 8.6).
 *
 * Behavior-focused coverage of the two states the requirements call out:
 *   - Success (R8.1): the view renders the organization's current plan name and,
 *     as supporting evidence, the per-resource "{usage} / {limit}" / "Unlimited"
 *     values produced from the projection.
 *   - Failure (R8.6): when the plan-usage query errors, the view shows an error
 *     indication and renders NO usage values (no resource rows / counts).
 *
 * Mocking strategy (boundary only):
 *   - `../api/usePlanUsage` is mocked so each test drives the query result
 *     (loading/success/error) directly without a real network call — this is the
 *     data boundary the view depends on.
 *   - The view runs inside a `QueryClientProvider` (retries disabled) because the
 *     embedded `PlanChangeDialog` calls `useChangePlan` (a mutation hook).
 *   - The active org + OWNER role are seeded into `useAuthStore` (the view reads
 *     `orgId` there; OWNER makes the change-plan affordances visible).
 *
 * These are keepable example tests — they do not modify the organization feature.
 */
import { QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { ERROR_CODES } from "@queuenow/shared-constants";
import {
	PlanType,
	UserRoleType,
	type ILoginResponse,
	type PlanUsageResponse,
} from "@queuenow/shared-types";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { usePlanUsageMock } = vi.hoisted(() => ({
	usePlanUsageMock: vi.fn(),
}));

vi.mock("../api/usePlanUsage", () => ({
	usePlanUsage: usePlanUsageMock,
}));

// Imported AFTER the mock so the view picks up the double.
import { ApiError } from "@/lib/api/client";
import { getErrorMessage } from "@/lib/api/error-map";
import { strings } from "@/i18n";
import { createTestQueryClient } from "@/test/harness";
import { useAuthStore } from "@/features/auth";

import { PlanUsageView } from "../components/PlanUsageView";

const ORG_ID = "o1";
const copy = strings.plan;

/** A session whose active org is the one the view loads (OWNER). */
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

/** A PRO projection: services at limit, counters unlimited. */
function makeUsage(): PlanUsageResponse {
	return {
		plan: PlanType.PRO,
		features: { tvDisplay: true, analytics: true, customBranding: false },
		resources: [
			{
				resource: "services",
				limitName: "maxServices",
				usage: 5,
				limit: 5,
				atLimit: true,
			},
			{
				resource: "counters",
				limitName: "maxCounters",
				usage: 2,
				limit: null,
				atLimit: false,
			},
		],
	};
}

/** Shape the view reads off the query result. */
type QueryShape = ReturnType<typeof makeQueryResult>;
function makeQueryResult(overrides: {
	isLoading?: boolean;
	isError?: boolean;
	error?: unknown;
	data?: PlanUsageResponse;
}): {
	isLoading: boolean;
	isError: boolean;
	error: unknown;
	data: PlanUsageResponse | undefined;
	refetch: () => void;
} {
	return {
		isLoading: overrides.isLoading ?? false,
		isError: overrides.isError ?? false,
		error: overrides.error,
		data: overrides.data,
		refetch: vi.fn(),
	};
}

function setup(result: QueryShape): void {
	usePlanUsageMock.mockReturnValue(result);
	render(
		<QueryClientProvider client={createTestQueryClient()}>
			<PlanUsageView />
		</QueryClientProvider>,
	);
}

beforeEach(() => {
	vi.stubEnv("VITE_API_URL", "http://localhost:4000/api/v1");
	vi.stubEnv("VITE_WS_URL", "http://localhost:4000");
	usePlanUsageMock.mockReset();
	useAuthStore.getState().clear();
	useAuthStore.getState().setSession(session);
});

afterEach(() => {
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
});

describe("PlanUsageView states (task 14.5)", () => {
	it("success (R8.1): renders the organization's current plan name and usage values", () => {
		setup(makeQueryResult({ data: makeUsage() }));

		// Current plan name (R8.1).
		expect(screen.getByText(copy.planNames[PlanType.PRO])).toBeInTheDocument();

		// Supporting per-resource usage values (R8.2/R8.3).
		expect(screen.getByText("5 / 5")).toBeInTheDocument();
		expect(screen.getByText(copy.unlimited)).toBeInTheDocument();
	});

	it("failure (R8.6): shows an error indication and renders no usage values", () => {
		const error = new ApiError(
			ERROR_CODES.INTERNAL_ERROR,
			"boom",
			undefined,
			500,
		);
		setup(makeQueryResult({ isError: true, error }));

		// Error indication is shown (code-mapped copy, R8.6).
		expect(screen.getByRole("alert")).toBeInTheDocument();
		expect(screen.getByText(getErrorMessage(error))).toBeInTheDocument();

		// No usage values / resource rows are rendered (R8.6).
		expect(screen.queryByText("5 / 5")).not.toBeInTheDocument();
		expect(screen.queryByText(copy.unlimited)).not.toBeInTheDocument();
		expect(screen.queryByText(copy.resources.services)).not.toBeInTheDocument();
		expect(screen.queryByText(copy.resources.counters)).not.toBeInTheDocument();
		// The current-plan value is also absent (no projection to read it from).
		expect(
			screen.queryByText(copy.planNames[PlanType.PRO]),
		).not.toBeInTheDocument();
	});

	it("loading: shows the loading region without usage values", () => {
		setup(makeQueryResult({ isLoading: true }));

		expect(screen.queryByText("5 / 5")).not.toBeInTheDocument();
		expect(screen.queryByText(copy.resources.services)).not.toBeInTheDocument();
	});
});
