/**
 * Kiosk join-flow example tests (task 16.3, Requirements 12.4, 12.5, 12.6, 12.7).
 *
 * Behavior-focused coverage of the public Kiosk flow, driven through the real
 * `KioskScreen` surface (which wires `ServiceSelection`, `JoinForm`,
 * `TicketResult`, the public read/join hooks, and the idle-reset hook) so the
 * assertions reflect what a walk-in customer actually triggers:
 *
 *   1. Join + ticket/QR (12.4, 12.5): pick a service → confirm → the join
 *      endpoint is called with the validated payload (`serviceId`); the assigned
 *      ticket number is shown AND a tracking QR code is rendered.
 *   2. QUEUE_FULL (12.6): the join rejects with a real `ApiError('QUEUE_FULL')`
 *      → the dedicated "queue is full" message is shown, no ticket appears, and
 *      the failure is NOT toasted (it is an expected, inline outcome).
 *   3. Idle reset (12.7): once past the start screen, after the configured idle
 *      timeout elapses (fake timers) the kiosk resets to service selection.
 *
 * Mocking strategy (boundary only):
 *   - `@/lib/api/client` keeps everything real EXCEPT `apiClient.get/post`,
 *     routed per request path: the public queue-status read returns the active
 *     services, the public settings read drives required-field gating, and the
 *     join POST resolves with a ticket or rejects with a real `ApiError` so the
 *     `QUEUE_FULL` branch flows exactly as in production.
 *   - `sonner` `toast.error` is a spy so we can assert QUEUE_FULL is NOT toasted.
 *   - `qrcode` is stubbed so the async QR encode resolves deterministically to a
 *     known SVG (no real canvas/encoding in jsdom).
 *   - Components run inside a `QueryClientProvider` from the test harness
 *     (`createTestQueryClient`, retries disabled). The Kiosk is public — no auth.
 *
 * These are keepable example tests — they do not modify the kiosk feature.
 */
import { QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ERROR_CODES } from "@queuenow/shared-constants";
import {
	afterEach,
	beforeAll,
	beforeEach,
	describe,
	expect,
	it,
	vi,
} from "vitest";

const { getMock, postMock, toastErrorMock, qrToStringMock } = vi.hoisted(
	() => ({
		getMock: vi.fn(),
		postMock: vi.fn(),
		toastErrorMock: vi.fn(),
		qrToStringMock: vi.fn(),
	}),
);

vi.mock("sonner", () => ({
	toast: { success: vi.fn(), error: toastErrorMock },
}));

vi.mock("qrcode", () => ({
	// `TicketQrCode` calls `QRCode.toString(value, { type: 'svg', ... })`.
	toString: qrToStringMock,
}));

vi.mock("@/lib/api/client", async (importActual) => {
	const actual = await importActual<typeof import("@/lib/api/client")>();
	return {
		...actual,
		apiClient: {
			...actual.apiClient,
			// Drive the public reads + join per test; keep the rest of the client real.
			get: getMock as unknown as typeof actual.apiClient.get,
			post: postMock as unknown as typeof actual.apiClient.post,
		},
	};
});

// Imported AFTER the mocks so the screen/hooks pick up the doubles.
import { ApiError } from "@/lib/api/client";
import { strings } from "@/i18n";
import { createTestQueryClient } from "@/test/harness";

import { kioskEndpoints } from "../api/endpoints";
import { KIOSK_IDLE_TIMEOUT_MS } from "../lib/constants";
import { KioskScreen } from "../components/KioskScreen";

const ORG_ID = "org-1";
// serviceId must be a valid UUID — `joinQueueSchema` validates it before submit.
const SERVICE_ID = "11111111-1111-4111-8111-111111111111";
const SERVICE = { id: SERVICE_ID, name: "General", prefix: "GEN" };

const copy = strings.kiosk;

/** Queue settings returned by the public settings read; default requires nothing. */
let settings: { requireName: boolean; requirePhone: boolean } = {
	requireName: false,
	requirePhone: false,
};

/**
 * Route the public GET reads by path: the queue-status aggregate yields the
 * active services; the settings endpoint yields the required-field gating.
 */
function installReads(): void {
	getMock.mockImplementation(async (path: string) => {
		if (path === kioskEndpoints.activeServices(ORG_ID)) {
			return { data: { services: [{ service: { ...SERVICE } }] } };
		}
		if (path === kioskEndpoints.queueSettings(ORG_ID)) {
			return { data: { ...settings } };
		}
		throw new ApiError("INTERNAL_ERROR", `unexpected GET ${path}`);
	});
}

/** Render the Kiosk inside a fresh, retry-disabled QueryClient (public, no auth). */
function setup(): void {
	const queryClient = createTestQueryClient();
	render(
		<QueryClientProvider client={queryClient}>
			<KioskScreen orgId={ORG_ID} />
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
	postMock.mockReset();
	toastErrorMock.mockReset();
	qrToStringMock.mockReset();
	qrToStringMock.mockResolvedValue("<svg data-qr='ok'></svg>");
	settings = { requireName: false, requirePhone: false };
	installReads();
});

afterEach(() => {
	vi.useRealTimers();
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
});

describe("kiosk join flow (task 16.3)", () => {
	it("join + ticket/QR (12.4, 12.5): selecting a service and confirming joins the queue and shows the ticket number plus a tracking QR", async () => {
		const user = userEvent.setup();
		postMock.mockResolvedValueOnce({
			data: {
				id: "ticket-1",
				ticketNumber: "GEN012",
				position: 3,
				estimatedWaitMinutes: 15,
			},
		});

		setup();

		// Start screen: tap the active service tile.
		await user.click(await screen.findByRole("button", { name: /General/ }));

		// Details/confirm step (no required fields with default settings).
		await user.click(await screen.findByRole("button", { name: copy.confirm }));

		// The validated join payload reaches the public join endpoint (R12.4).
		await waitFor(() =>
			expect(postMock).toHaveBeenCalledWith(
				kioskEndpoints.join(ORG_ID),
				expect.objectContaining({ serviceId: SERVICE_ID }),
			),
		);

		// The assigned ticket number is shown prominently (R12.4)…
		expect(await screen.findByText("GEN012")).toBeInTheDocument();
		expect(screen.getByText(copy.yourNumberLabel)).toBeInTheDocument();

		// …and the tracking QR is rendered once encoding resolves (R12.5).
		expect(
			await screen.findByRole("img", { name: copy.scanToTrack }),
		).toBeInTheDocument();
		expect(qrToStringMock).toHaveBeenCalledWith(
			expect.stringContaining(`/track/${ORG_ID}/ticket-1`),
			expect.objectContaining({ type: "svg" }),
		);

		expect(toastErrorMock).not.toHaveBeenCalled();
	});

	it("QUEUE_FULL (12.6): a QUEUE_FULL rejection shows the queue-is-full message, no ticket, and is not toasted", async () => {
		const user = userEvent.setup();
		postMock.mockRejectedValueOnce(
			new ApiError(
				ERROR_CODES.QUEUE_FULL,
				"Today's queue is full",
				undefined,
				409,
			),
		);

		setup();

		await user.click(await screen.findByRole("button", { name: /General/ }));
		await user.click(await screen.findByRole("button", { name: copy.confirm }));

		// The dedicated "queue is full" message is surfaced inline (R12.6).
		expect(await screen.findByText(copy.queueFullTitle)).toBeInTheDocument();
		expect(screen.getByText(copy.queueFullBody)).toBeInTheDocument();

		// The flow does NOT advance to a ticket…
		expect(screen.queryByText(copy.ticketTitle)).not.toBeInTheDocument();
		expect(screen.queryByText(copy.yourNumberLabel)).not.toBeInTheDocument();

		// …and QUEUE_FULL is an expected, inline outcome — never a toast.
		expect(toastErrorMock).not.toHaveBeenCalled();
	});

	it("idle reset (12.7): after the idle timeout the kiosk resets to the service-selection start screen", async () => {
		// Real time still advances (so RTL queries/userEvent work), but we control
		// the kiosk idle timer explicitly via `advanceTimersByTime`.
		vi.useFakeTimers({ shouldAdvanceTime: true });
		const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });

		setup();

		// Move past the start screen so the idle timer becomes active.
		await user.click(await screen.findByRole("button", { name: /General/ }));
		expect(await screen.findByText(copy.detailsTitle)).toBeInTheDocument();

		// Sit idle past the configured timeout — the kiosk returns to selection.
		act(() => {
			vi.advanceTimersByTime(KIOSK_IDLE_TIMEOUT_MS + 1);
		});

		expect(
			await screen.findByRole("heading", { name: copy.selectServiceTitle }),
		).toBeInTheDocument();
		expect(screen.queryByText(copy.detailsTitle)).not.toBeInTheDocument();
	});
});
