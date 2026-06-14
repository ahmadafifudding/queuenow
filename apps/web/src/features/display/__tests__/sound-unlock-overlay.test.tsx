/**
 * Display sound-unlock overlay example test (task 9.3, Requirement 15.1).
 *
 * Behavior-focused coverage of the one-time "tap to enable sound" gesture
 * overlay on the public Display board (R7.6): browsers block audio until a user
 * gesture, so the board shows a full-bleed overlay on first load; tapping it
 * unlocks audio and dismisses the overlay, and it must NOT reappear when later
 * called-ticket updates arrive.
 *
 * This drives the behavior through the real `DisplayBoard`, because the
 * "shown once" guarantee lives in the board's wiring of `useAnnouncer`
 * (canAnnounce) + local `soundUnlocked` state, not in the presentational
 * `SoundUnlockOverlay` itself.
 *
 * Mocking strategy (boundary only — implementation is NOT modified):
 *   - The public queue read (`useDisplayQueue`) is mocked so the test controls
 *     the board data and can simulate a new called ticket arriving.
 *   - The realtime/polling side-effect hooks (`useSocketSubscription`,
 *     `usePollingFallback`) are mocked to no-ops so the board mounts without a
 *     real socket.
 *   - `AudioContext` is stubbed via `vi.stubGlobal` so the announcer reports it
 *     can produce sound (`canAnnounce === true`); that is the precondition for
 *     the board to render the overlay at all.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

import { strings } from "@/i18n";

import type { DisplayQueueStatus } from "../types";

const { useDisplayQueueMock } = vi.hoisted(() => ({
	useDisplayQueueMock: vi.fn(),
}));

vi.mock("../api/useDisplayQueue", () => ({
	useDisplayQueue: useDisplayQueueMock,
}));

vi.mock("@/hooks/useSocketSubscription", () => ({
	useSocketSubscription: vi.fn(),
}));

vi.mock("@/hooks/usePollingFallback", () => ({
	usePollingFallback: vi.fn(),
}));

// Imported AFTER the mocks so the board picks up the doubles.
import { DisplayBoard } from "../components/DisplayBoard";

// ---------------------------------------------------------------------------
// Minimal Web Audio double — its mere presence makes `canAnnounce` true, which
// is the precondition for the overlay to render.
// ---------------------------------------------------------------------------

class MockAudioParam {
	readonly setValueAtTime = vi.fn();
	readonly exponentialRampToValueAtTime = vi.fn();
}

class MockAudioContext {
	state: AudioContextState = "running";
	currentTime = 0;
	destination = {} as AudioDestinationNode;

	readonly resume = vi.fn(() => Promise.resolve());
	readonly createGain = vi.fn(() => ({
		gain: new MockAudioParam(),
		connect: vi.fn(),
	}));
	readonly createOscillator = vi.fn(() => ({
		type: "sine",
		frequency: new MockAudioParam(),
		connect: vi.fn(),
		start: vi.fn(),
		stop: vi.fn(),
	}));
}

/** Build a public queue-status payload whose one service has the given called numbers. */
function makeStatus(calledNumbers: string[]): DisplayQueueStatus {
	return {
		organizationId: "org-1",
		organizationName: "Acme Clinic",
		services: [
			{
				service: { id: "svc-1", name: "General", prefix: "A" },
				waiting: 3,
				currentlyCalled: calledNumbers.map((ticketNumber) => ({
					ticketNumber,
					counterName: "Counter 1",
				})),
				serving: 1,
				completedToday: 10,
				estimatedWaitMinutes: 12,
			},
		],
		lastUpdated: "2024-01-01T08:00:00.000Z",
	};
}

/** Point the mocked query at a given payload (settled, no error). */
function mockQuery(data: DisplayQueueStatus): void {
	useDisplayQueueMock.mockReturnValue({
		data,
		isLoading: false,
		isError: false,
		error: null,
		refetch: vi.fn(),
	});
}

beforeEach(() => {
	useDisplayQueueMock.mockReset();
});

afterEach(() => {
	cleanup();
	vi.unstubAllGlobals();
});

describe("DisplayBoard sound-unlock overlay (R7.6, Req 15.1)", () => {
	it("shows the overlay once, then never again after the unlock gesture", () => {
		vi.stubGlobal("AudioContext", MockAudioContext);
		mockQuery(makeStatus(["A001"]));

		const { rerender } = render(<DisplayBoard orgId="org-1" />);

		// First load: the overlay is present (audio is supported but not unlocked).
		const overlay = screen.getByRole("button", {
			name: strings.display.enableSoundTitle,
		});
		expect(overlay).toBeInTheDocument();

		// Tapping it unlocks audio and dismisses the overlay.
		fireEvent.click(overlay);
		expect(
			screen.queryByRole("button", { name: strings.display.enableSoundTitle }),
		).not.toBeInTheDocument();

		// A subsequent called-ticket update must NOT bring the overlay back.
		mockQuery(makeStatus(["A002", "A001"]));
		rerender(<DisplayBoard orgId="org-1" />);

		expect(
			screen.queryByRole("button", { name: strings.display.enableSoundTitle }),
		).not.toBeInTheDocument();
	});
});
