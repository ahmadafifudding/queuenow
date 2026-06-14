/**
 * Queue serving-action example tests (task 8.4, Requirement 15.3).
 *
 * Behavior-focused coverage of the five staff serving mutations — call next,
 * recall, skip, complete, rejoin — exercised through their real hooks
 * (`useCallNextTicket` … `useRejoinTicket`) and the shared `useServingMutation`
 * lifecycle (`onMutate` snapshot+patch → `onError` rollback+toast → `onSettled`
 * invalidation). Each scenario asserts the OPTIMISTIC cache patch (the state
 * right after `mutate`, before the request settles) AND the RECONCILIATION
 * (queue-key invalidation after settle) wherever practical.
 *
 * Mocking strategy (boundary only):
 *   - `@/lib/api/client` keeps everything real EXCEPT `apiClient.post`, a spy we
 *     drive per test. This preserves the real `ApiError` class so the error
 *     paths (`QUEUE_NO_WAITING`, `QUEUE_MAX_RECALL`) flow exactly as in prod.
 *   - `sonner` `toast.error` is a spy so we can assert the code-mapped copy.
 *   - Hooks run inside a `QueryClientProvider` built from the test harness
 *     (`createTestQueryClient`, retries disabled). The queue cache is seeded at
 *     `queryKeys.queue(orgId)` with a `QueueStatusResponse` so optimistic
 *     patches are observable, and `invalidateQueries` is spied to prove the
 *     post-settle reconcile (REST success + socket `queue:update` hit the same
 *     key).
 *
 * These are keepable example tests — they do not modify the hooks under test.
 */
import { createElement, type ReactNode } from "react";
import {
	QueryClientProvider,
	type QueryClient,
	type QueryKey,
} from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import { ERROR_CODES } from "@queuenow/shared-constants";
import { TicketStatus, type IQueueTicket } from "@queuenow/shared-types";
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

const { postMock, toastErrorMock } = vi.hoisted(() => ({
	postMock: vi.fn(),
	toastErrorMock: vi.fn(),
}));

vi.mock("sonner", () => ({
	toast: { error: toastErrorMock, success: vi.fn() },
}));

vi.mock("@/lib/api/client", async (importActual) => {
	const actual = await importActual<typeof import("@/lib/api/client")>();
	return {
		...actual,
		apiClient: {
			...actual.apiClient,
			// Drive each serving action's outcome per test; keep the rest real.
			post: postMock as unknown as typeof actual.apiClient.post,
		},
	};
});

// Imported AFTER the mocks so the hooks pick up the doubles.
import { ApiError } from "@/lib/api/client";
import { getErrorMessage } from "@/lib/api/error-map";
import { queryKeys } from "@/lib/api/query-keys";
import { strings } from "@/i18n";
import { createTestQueryClient } from "@/test/harness";

import { useCallNextTicket } from "../api/useCallNextTicket";
import { useCompleteTicket } from "../api/useCompleteTicket";
import { useRecallTicket } from "../api/useRecallTicket";
import { useRejoinTicket } from "../api/useRejoinTicket";
import { useSkipTicket } from "../api/useSkipTicket";
import { useCounterSelectionStore } from "../stores/counter-selection-store";
import type { QueueStatusResponse } from "../types";

const ORG_ID = "org-1";
const SERVICE_ID = "svc-1";
const COUNTER_ID = "cnt-1";
const TICKET_NUMBER = "A012";

/** Build a fresh, fully-typed queue snapshot so each test mutates its own copy. */
function makeStatus(): QueueStatusResponse {
	return {
		organizationId: ORG_ID,
		organizationName: "Acme",
		services: [
			{
				service: { id: SERVICE_ID, name: "General", prefix: "A" },
				waiting: 5,
				currentlyCalled: [
					{ ticketNumber: TICKET_NUMBER, counterName: "Counter 1" },
				],
				serving: 2,
				completedToday: 7,
				estimatedWaitMinutes: 25,
			},
			{
				service: { id: "svc-2", name: "Priority", prefix: "P" },
				waiting: 3,
				currentlyCalled: [],
				serving: 1,
				completedToday: 4,
				estimatedWaitMinutes: 15,
			},
		],
		lastUpdated: "2024-01-01T00:00:00.000Z",
	};
}

/** A CALLED ticket as returned by the serving endpoints. */
function makeTicket(overrides: Partial<IQueueTicket> = {}): IQueueTicket {
	return {
		id: "tkt-1",
		orgId: ORG_ID,
		serviceId: SERVICE_ID,
		counterId: COUNTER_ID,
		ticketNumber: TICKET_NUMBER,
		dailyNumber: 12,
		status: TicketStatus.CALLED,
		recallCount: 0,
		isRejoin: false,
		createdAt: "2024-01-01T00:00:00.000Z",
		...overrides,
	};
}

/** A deferred promise so a test can observe the optimistic state before settle. */
function deferred<T>(): {
	promise: Promise<T>;
	resolve: (value: T) => void;
	reject: (error: unknown) => void;
} {
	let resolve!: (value: T) => void;
	let reject!: (error: unknown) => void;
	const promise = new Promise<T>((res, rej) => {
		resolve = res;
		reject = rej;
	});
	return { promise, resolve, reject };
}

interface Harness {
	queryClient: QueryClient;
	queueKey: QueryKey;
	/** Read the current queue snapshot from the cache (seeded, non-null). */
	read: () => QueueStatusResponse;
	/** Spy on the queue-key invalidation that reconciles after settle. */
	invalidateSpy: MockInstance;
	wrapper: ({ children }: { children: ReactNode }) => ReactNode;
}

/** Seed the queue cache and wire a provider + invalidation spy for a test. */
function setup(): Harness {
	const queryClient = createTestQueryClient();
	const queueKey = queryKeys.queue(ORG_ID);
	queryClient.setQueryData<QueueStatusResponse>(queueKey, makeStatus());

	const invalidateSpy = vi
		.spyOn(queryClient, "invalidateQueries")
		.mockReturnValue(Promise.resolve());

	const read = (): QueueStatusResponse => {
		const data = queryClient.getQueryData<QueueStatusResponse>(queueKey);
		if (data === undefined) {
			throw new Error("queue cache was unexpectedly empty");
		}
		return data;
	};

	const wrapper = ({ children }: { children: ReactNode }): ReactNode =>
		createElement(QueryClientProvider, { client: queryClient }, children);

	return { queryClient, queueKey, read, invalidateSpy, wrapper };
}

/** The first service card (`svc-1`) the actions target. */
function svc1(
	status: QueueStatusResponse,
): QueueStatusResponse["services"][number] {
	const service = status.services.find(
		(entry) => entry.service.id === SERVICE_ID,
	);
	if (service === undefined) {
		throw new Error("svc-1 missing from seeded status");
	}
	return service;
}

beforeAll(() => {
	// Deterministic base URL so the real client module imports cleanly.
	vi.stubEnv("VITE_API_URL", "http://localhost:4000/api/v1");
	vi.stubEnv("VITE_WS_URL", "http://localhost:4000");
});

beforeEach(() => {
	postMock.mockReset();
	toastErrorMock.mockReset();
	useCounterSelectionStore.getState().clear();
});

afterEach(() => {
	vi.unstubAllGlobals();
});

describe("queue serving actions (task 8.4)", () => {
	it("call next (success): posts the counterId, decrements waiting optimistically, then reconciles", async () => {
		const { read, queueKey, invalidateSpy, wrapper } = setup();
		const pending = deferred<{ data: IQueueTicket }>();
		postMock.mockReturnValueOnce(pending.promise);

		const { result } = renderHook(() => useCallNextTicket({ orgId: ORG_ID }), {
			wrapper,
		});

		result.current.mutate({ counterId: COUNTER_ID, serviceId: SERVICE_ID });

		// Optimistic: waiting 5 → 4 before the request settles; other service untouched.
		await waitFor(() => expect(svc1(read()).waiting).toBe(4));
		const otherService = read().services.find(
			(entry) => entry.service.id === "svc-2",
		);
		expect(otherService?.waiting).toBe(3);
		expect(postMock).toHaveBeenCalledWith(
			"/organizations/org-1/queue/call-next",
			{
				counterId: COUNTER_ID,
			},
		);

		pending.resolve({ data: makeTicket() });

		await waitFor(() => expect(result.current.isSuccess).toBe(true));
		// Reconcile: the queue key is invalidated on settle (socket queue:update shares it).
		expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: queueKey });
	});

	it("call next (empty queue): QUEUE_NO_WAITING shows the empty-queue message and rolls back", async () => {
		const { read, queueKey, invalidateSpy, wrapper } = setup();
		const pending = deferred<{ data: IQueueTicket }>();
		postMock.mockReturnValueOnce(pending.promise);
		const error = new ApiError(
			"QUEUE_NO_WAITING",
			"no one waiting",
			undefined,
			409,
		);

		const { result } = renderHook(() => useCallNextTicket({ orgId: ORG_ID }), {
			wrapper,
		});

		result.current.mutate({ counterId: COUNTER_ID, serviceId: SERVICE_ID });

		// Optimistic patch is applied first (waiting 5 → 4)…
		await waitFor(() => expect(svc1(read()).waiting).toBe(4));

		// …then the request fails and the cache rolls back to the snapshot (5).
		pending.reject(error);
		await waitFor(() => expect(result.current.isError).toBe(true));
		expect(svc1(read()).waiting).toBe(5);

		// The empty-queue copy is surfaced via the error map.
		expect(getErrorMessage(error)).toBe(
			strings.errors[ERROR_CODES.QUEUE_NO_WAITING],
		);
		expect(toastErrorMock).toHaveBeenCalledWith(getErrorMessage(error));
		expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: queueKey });
	});

	it("recall (success): posts to the recall endpoint and reconciles (no aggregate patch)", async () => {
		const { read, queueKey, invalidateSpy, wrapper } = setup();
		const before = svc1(read());
		postMock.mockResolvedValueOnce({ data: makeTicket({ recallCount: 1 }) });

		const { result } = renderHook(() => useRecallTicket({ orgId: ORG_ID }), {
			wrapper,
		});

		result.current.mutate({ ticketId: "tkt-1", serviceId: SERVICE_ID });

		await waitFor(() => expect(result.current.isSuccess).toBe(true));
		// Recall has no aggregate-visible optimistic patch; counts are unchanged.
		expect(svc1(read())).toEqual(before);
		expect(postMock).toHaveBeenCalledWith(
			"/organizations/org-1/queue/tkt-1/recall",
		);
		expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: queueKey });
	});

	it("recall (max recall): QUEUE_MAX_RECALL shows the skip/call-next advice and reconciles", async () => {
		const { read, queueKey, invalidateSpy, wrapper } = setup();
		const before = svc1(read());
		const error = new ApiError(
			"QUEUE_MAX_RECALL",
			"recall limit hit",
			undefined,
			409,
		);
		postMock.mockRejectedValueOnce(error);

		const { result } = renderHook(() => useRecallTicket({ orgId: ORG_ID }), {
			wrapper,
		});

		result.current.mutate({ ticketId: "tkt-1", serviceId: SERVICE_ID });

		await waitFor(() => expect(result.current.isError).toBe(true));
		// No patch was applied, so the snapshot is intact after rollback.
		expect(svc1(read())).toEqual(before);
		// The "skip it / call next" advice copy is surfaced via the error map.
		expect(getErrorMessage(error)).toBe(
			strings.errors[ERROR_CODES.QUEUE_MAX_RECALL],
		);
		expect(toastErrorMock).toHaveBeenCalledWith(getErrorMessage(error));
		expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: queueKey });
	});

	it("skip (success): optimistically removes the ticket from currentlyCalled, then reconciles", async () => {
		const { read, queueKey, invalidateSpy, wrapper } = setup();
		const pending = deferred<{ data: IQueueTicket }>();
		postMock.mockReturnValueOnce(pending.promise);

		const { result } = renderHook(() => useSkipTicket({ orgId: ORG_ID }), {
			wrapper,
		});

		result.current.mutate({
			ticketId: "tkt-1",
			serviceId: SERVICE_ID,
			ticketNumber: TICKET_NUMBER,
		});

		// Optimistic: the called ticket disappears from the active list immediately.
		await waitFor(() => expect(svc1(read()).currentlyCalled).toHaveLength(0));

		pending.resolve({ data: makeTicket({ status: TicketStatus.SKIPPED }) });

		await waitFor(() => expect(result.current.isSuccess).toBe(true));
		expect(postMock).toHaveBeenCalledWith(
			"/organizations/org-1/queue/tkt-1/skip",
		);
		expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: queueKey });
	});

	it("complete (success): optimistically drops the ticket, decrements serving, bumps completed, then reconciles", async () => {
		const { read, queueKey, invalidateSpy, wrapper } = setup();
		const pending = deferred<{ data: IQueueTicket }>();
		postMock.mockReturnValueOnce(pending.promise);

		const { result } = renderHook(() => useCompleteTicket({ orgId: ORG_ID }), {
			wrapper,
		});

		result.current.mutate({
			ticketId: "tkt-1",
			serviceId: SERVICE_ID,
			ticketNumber: TICKET_NUMBER,
		});

		// Optimistic: drop from currentlyCalled, serving 2 → 1, completedToday 7 → 8.
		await waitFor(() => {
			const service = svc1(read());
			expect(service.currentlyCalled).toHaveLength(0);
			expect(service.serving).toBe(1);
			expect(service.completedToday).toBe(8);
		});

		pending.resolve({ data: makeTicket({ status: TicketStatus.COMPLETED }) });

		await waitFor(() => expect(result.current.isSuccess).toBe(true));
		expect(postMock).toHaveBeenCalledWith(
			"/organizations/org-1/queue/tkt-1/complete",
		);
		expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: queueKey });
	});

	it("rejoin (success): optimistically increments waiting toward the queue, then reconciles", async () => {
		const { read, queueKey, invalidateSpy, wrapper } = setup();
		const pending = deferred<{ data: IQueueTicket & { position: number } }>();
		postMock.mockReturnValueOnce(pending.promise);

		const { result } = renderHook(() => useRejoinTicket({ orgId: ORG_ID }), {
			wrapper,
		});

		result.current.mutate({ ticketId: "tkt-1", serviceId: SERVICE_ID });

		// Optimistic: a skipped ticket returns toward WAITING (5 → 6).
		await waitFor(() => expect(svc1(read()).waiting).toBe(6));

		pending.resolve({
			data: { ...makeTicket({ status: TicketStatus.WAITING }), position: 6 },
		});

		await waitFor(() => expect(result.current.isSuccess).toBe(true));
		expect(postMock).toHaveBeenCalledWith(
			"/organizations/org-1/queue/tkt-1/rejoin",
		);
		expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: queueKey });
	});
});
