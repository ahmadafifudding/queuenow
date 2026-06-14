/**
 * Ticket-tracking page example tests.
 *
 * Behavior-focused coverage of the public `TicketTracker` (opened from the
 * kiosk QR). The `useTicketStatus` hook is mocked at the module boundary so each
 * test controls the query result without timers/network; the component's real
 * rendering (status headline/detail, ticket number, position/ETA, error state)
 * is exercised.
 */
import type { UseQueryResult } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { TicketStatus } from "@queuenow/shared-types";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "@/lib/api/client";
import { strings } from "@/i18n";

import type { TrackedTicket } from "../types";

const { useTicketStatusMock } = vi.hoisted(() => ({
	useTicketStatusMock: vi.fn(),
}));

vi.mock("../api/useTicketStatus", () => ({
	useTicketStatus: useTicketStatusMock,
	isTerminalStatus: vi.fn(),
}));

// Imported AFTER the mock so the component picks up the doubled hook.
import { TicketTracker } from "../components/TicketTracker";

const copy = strings.tracking;

/** Build a tracked-ticket fixture. */
function makeTicket(overrides: Partial<TrackedTicket> = {}): TrackedTicket {
	return {
		id: "tkt-1",
		ticketNumber: "GEN012",
		status: TicketStatus.WAITING,
		recallCount: 0,
		service: { id: "svc-1", name: "General Consultation", prefix: "GEN" },
		counter: null,
		position: null,
		estimatedWaitMinutes: null,
		...overrides,
	};
}

/** Cast a partial query result to the full type for the mocked hook. */
function asQueryResult(
	partial: Partial<UseQueryResult<TrackedTicket, ApiError>>,
): UseQueryResult<TrackedTicket, ApiError> {
	return {
		isLoading: false,
		isError: false,
		error: null,
		data: undefined,
		refetch: vi.fn(),
		...partial,
	} as UseQueryResult<TrackedTicket, ApiError>;
}

afterEach(() => {
	useTicketStatusMock.mockReset();
});

describe("TicketTracker", () => {
	it("shows the ticket number, waiting status, position and estimated wait", () => {
		useTicketStatusMock.mockReturnValue(
			asQueryResult({
				data: makeTicket({
					status: TicketStatus.WAITING,
					position: 3,
					estimatedWaitMinutes: 20,
				}),
			}),
		);

		render(<TicketTracker orgId="org-1" ticketId="tkt-1" />);

		expect(screen.getByText("GEN012")).toBeInTheDocument();
		expect(screen.getByText(copy.status.waitingHeadline)).toBeInTheDocument();
		expect(screen.getByText("You are number 3 in line.")).toBeInTheDocument();
		expect(screen.getByText("#3")).toBeInTheDocument();
		expect(screen.getByText(`20 ${copy.minutesSuffix}`)).toBeInTheDocument();
	});

	it("shows the called status with the counter to proceed to", () => {
		useTicketStatusMock.mockReturnValue(
			asQueryResult({
				data: makeTicket({
					status: TicketStatus.CALLED,
					counter: { id: "cnt-1", name: "Counter 1" },
				}),
			}),
		);

		render(<TicketTracker orgId="org-1" ticketId="tkt-1" />);

		expect(screen.getByText(copy.status.calledHeadline)).toBeInTheDocument();
		expect(
			screen.getByText("Please proceed to Counter 1."),
		).toBeInTheDocument();
	});

	it("renders a code-mapped error state when the ticket cannot be loaded", () => {
		const error = new ApiError("TICKET_NOT_FOUND", "nope", undefined, 404);
		useTicketStatusMock.mockReturnValue(
			asQueryResult({ isError: true, error }),
		);

		render(<TicketTracker orgId="org-1" ticketId="missing" />);

		expect(screen.getByRole("alert")).toBeInTheDocument();
		expect(
			screen.getByText(strings.errors.TICKET_NOT_FOUND),
		).toBeInTheDocument();
	});
});
