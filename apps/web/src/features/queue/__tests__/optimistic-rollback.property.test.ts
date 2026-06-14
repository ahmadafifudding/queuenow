// Feature: web-app, Property 10: Failed optimistic serving actions roll back to the snapshot
//
// Validates: Requirements 6.10, 6.11
//
// For ANY initial queue cache state and ANY serving action (call next, recall,
// skip, complete, rejoin), this drives the REAL serving mutation hooks
// (`useCallNextTicket`/`useRecallTicket`/`useSkipTicket`/`useCompleteTicket`/
// `useRejoinTicket`, all built on the shared `useServingMutation` factory)
// through a real `QueryClient` + `QueryClientProvider` and asserts the optimistic
// lifecycle:
//
//   * FAILURE (request rejects with an `ApiError`): after the mutation settles,
//     the queue cache at `queryKeys.queue(orgId, scopeServiceId)` is restored to
//     DEEP-EQUAL the pre-mutation snapshot (R6.11 rollback), and an error toast
//     mapped from the error code is shown.
//   * SUCCESS (request resolves): the optimistic patch (computed independently
//     via the pure `serving-patches` helpers) is applied to the cache AND the
//     queue key is invalidated, i.e. a server/socket reconcile is scheduled
//     (R6.10).
//
// Success/failure is forced deterministically by mocking `apiClient.post` at the
// boundary (the real `ApiError` class is preserved). fast-check, min 100 runs.
import type { ReactElement, ReactNode } from 'react';
import { QueryClientProvider, type QueryClient } from '@tanstack/react-query';
import { act, cleanup, renderHook } from '@testing-library/react';
import type { IQueueTicket } from '@queuenow/shared-types';
import fc from 'fast-check';
import { createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { postMock, toastErrorMock } = vi.hoisted(() => ({
  postMock: vi.fn(),
  toastErrorMock: vi.fn(),
}));

vi.mock('sonner', () => ({
  toast: { error: toastErrorMock },
}));

vi.mock('@/lib/api/client', async (importActual) => {
  const actual = await importActual<typeof import('@/lib/api/client')>();
  return {
    ...actual,
    apiClient: {
      ...actual.apiClient,
      // Drive serving-action outcomes per case; keep the rest of the client real
      // (notably the `ApiError` class the hooks' error path depends on).
      post: postMock as unknown as typeof actual.apiClient.post,
    },
  };
});

// Imported AFTER the mocks above so the hooks pick up the mocked `apiClient`.
import { ApiError } from '@/lib/api/client';
import { getErrorMessage } from '@/lib/api/error-map';
import { queryKeys } from '@/lib/api/query-keys';
import { createTestQueryClient } from '@/test/harness';

import type { CallNextVariables } from '../api/useCallNextTicket';
import { useCallNextTicket } from '../api/useCallNextTicket';
import type { CompleteVariables } from '../api/useCompleteTicket';
import { useCompleteTicket } from '../api/useCompleteTicket';
import type { RecallVariables } from '../api/useRecallTicket';
import { useRecallTicket } from '../api/useRecallTicket';
import type { RejoinResult, RejoinVariables } from '../api/useRejoinTicket';
import { useRejoinTicket } from '../api/useRejoinTicket';
import {
  applyCallNextPatch,
  applyCompletePatch,
  applyRejoinPatch,
  applySkipPatch,
} from '../api/serving-patches';
import type { SkipVariables } from '../api/useSkipTicket';
import { useSkipTicket } from '../api/useSkipTicket';
import type { ServingMutationContext } from '../api/useServingMutation';
import type { QueueServiceStatus, QueueStatusResponse } from '../types';

import type { UseMutationResult } from '@tanstack/react-query';

// ---------------------------------------------------------------------------
// The five real serving hooks, rendered together so a single `renderHook` can
// drive whichever action a case selects (all called unconditionally → Rules of
// Hooks hold).
// ---------------------------------------------------------------------------

interface HookOptions {
  orgId: string;
  scopeServiceId?: string;
}

interface HookSet {
  callNext: UseMutationResult<IQueueTicket, ApiError, CallNextVariables, ServingMutationContext>;
  recall: UseMutationResult<IQueueTicket, ApiError, RecallVariables, ServingMutationContext>;
  skip: UseMutationResult<IQueueTicket, ApiError, SkipVariables, ServingMutationContext>;
  complete: UseMutationResult<IQueueTicket, ApiError, CompleteVariables, ServingMutationContext>;
  rejoin: UseMutationResult<RejoinResult, ApiError, RejoinVariables, ServingMutationContext>;
}

function useServingHooks(options: HookOptions): HookSet {
  return {
    callNext: useCallNextTicket(options),
    recall: useRecallTicket(options),
    skip: useSkipTicket(options),
    complete: useCompleteTicket(options),
    rejoin: useRejoinTicket(options),
  };
}

// ---------------------------------------------------------------------------
// Generators
// ---------------------------------------------------------------------------

/** A short non-empty alphanumeric token (ids, names, ticket numbers). */
const tokenArb = fc
  .array(fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz0123456789'.split('')), {
    minLength: 1,
    maxLength: 8,
  })
  .map((chars) => chars.join(''));

/** Non-negative aggregate counts, bounded for sane cache sizes. */
const countArb = fc.nat({ max: 200 });

/** A single currently-called ticket summary (counterName optional → omit when absent). */
const calledTicketArb = fc
  .record({
    ticketNumber: tokenArb,
    counterName: fc.option(tokenArb, { nil: undefined }),
  })
  .map(({ ticketNumber, counterName }) =>
    counterName === undefined ? { ticketNumber } : { ticketNumber, counterName },
  );

/** A per-service snapshot matching `QueueServiceStatus`. */
const serviceStatusArb: fc.Arbitrary<QueueServiceStatus> = fc
  .record({
    id: tokenArb,
    name: tokenArb,
    prefix: tokenArb,
    waiting: countArb,
    currentlyCalled: fc.array(calledTicketArb, { maxLength: 5 }),
    serving: countArb,
    completedToday: countArb,
    estimatedWaitMinutes: countArb,
  })
  .map((r) => ({
    service: { id: r.id, name: r.name, prefix: r.prefix },
    waiting: r.waiting,
    currentlyCalled: r.currentlyCalled,
    serving: r.serving,
    completedToday: r.completedToday,
    estimatedWaitMinutes: r.estimatedWaitMinutes,
  }));

/** A full `QueueStatusResponse` with at least one service and unique service ids. */
const queueStatusArb: fc.Arbitrary<QueueStatusResponse> = fc.record({
  organizationId: tokenArb,
  organizationName: tokenArb,
  services: fc.uniqueArray(serviceStatusArb, {
    minLength: 1,
    maxLength: 4,
    selector: (s) => s.service.id,
  }),
  lastUpdated: fc.date({ noInvalidDate: true }).map((d) => d.toISOString()),
});

type ActionKind = 'callNext' | 'recall' | 'skip' | 'complete';

/** A fully-resolved test case: a seeded cache plus a concrete serving action. */
interface Scenario {
  readonly status: QueueStatusResponse;
  readonly scopeServiceId?: string;
  readonly actionKind: ActionKind | 'rejoin';
  readonly serviceId: string;
  readonly counterId: string;
  readonly ticketId: string;
  readonly ticketNumber: string;
}

/**
 * Build a scenario from a generated status: pick a real target service id, an
 * action, and (for skip/complete) a ticket number that is biased toward one that
 * actually exists in the target service's `currentlyCalled` so the optimistic
 * patch is observable.
 */
const scenarioArb: fc.Arbitrary<Scenario> = queueStatusArb.chain((status) => {
  const serviceIds = status.services.map((s) => s.service.id);
  return fc
    .record({
      scopeServiceId: fc.option(tokenArb, { nil: undefined }),
      actionKind: fc.constantFrom<Scenario['actionKind']>(
        'callNext',
        'recall',
        'skip',
        'complete',
        'rejoin',
      ),
      serviceId: fc.constantFrom(...serviceIds),
      counterId: tokenArb,
      ticketId: tokenArb,
      ticketSeed: fc.nat(),
      fallbackTicketNumber: tokenArb,
    })
    .map((sel) => {
      const target = status.services.find((s) => s.service.id === sel.serviceId);
      const called = target?.currentlyCalled ?? [];
      const existing = called.length > 0 ? called[sel.ticketSeed % called.length] : undefined;
      const ticketNumber = existing?.ticketNumber ?? sel.fallbackTicketNumber;
      return {
        status,
        scopeServiceId: sel.scopeServiceId,
        actionKind: sel.actionKind,
        serviceId: sel.serviceId,
        counterId: sel.counterId,
        ticketId: sel.ticketId,
        ticketNumber,
      } satisfies Scenario;
    });
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Independently recompute the expected optimistic cache via the pure patch helpers. */
function expectedOptimistic(
  snapshot: QueueStatusResponse,
  scenario: Scenario,
): QueueStatusResponse {
  switch (scenario.actionKind) {
    case 'callNext':
      return applyCallNextPatch(snapshot, { serviceId: scenario.serviceId });
    case 'skip':
      return applySkipPatch(snapshot, {
        serviceId: scenario.serviceId,
        ticketNumber: scenario.ticketNumber,
      });
    case 'complete':
      return applyCompletePatch(snapshot, {
        serviceId: scenario.serviceId,
        ticketNumber: scenario.ticketNumber,
      });
    case 'rejoin':
      return applyRejoinPatch(snapshot, { serviceId: scenario.serviceId });
    case 'recall':
      // Recall has no aggregate-visible optimistic patch → cache is unchanged.
      return snapshot;
  }
}

/** Invoke the action's real hook via `mutateAsync` (rejects on failure). */
async function runAction(hooks: HookSet, scenario: Scenario): Promise<void> {
  const { serviceId, counterId, ticketId, ticketNumber } = scenario;
  switch (scenario.actionKind) {
    case 'callNext':
      await hooks.callNext.mutateAsync({ serviceId, counterId });
      return;
    case 'recall':
      await hooks.recall.mutateAsync({ serviceId, ticketId });
      return;
    case 'skip':
      await hooks.skip.mutateAsync({ serviceId, ticketId, ticketNumber });
      return;
    case 'complete':
      await hooks.complete.mutateAsync({ serviceId, ticketId, ticketNumber });
      return;
    case 'rejoin':
      await hooks.rejoin.mutateAsync({ serviceId, ticketId });
      return;
  }
}

/** A wrapper providing the given client; lets each case seed a fresh client. */
function makeWrapper(client: QueryClient): (props: { children: ReactNode }) => ReactElement {
  return ({ children }) => createElement(QueryClientProvider, { client }, children);
}

function isInvalidated(client: QueryClient, key: readonly unknown[]): boolean {
  return client.getQueryState(key)?.isInvalidated === true;
}

// ---------------------------------------------------------------------------
// Property 10
// ---------------------------------------------------------------------------

describe('Property 10: failed optimistic serving actions roll back to the snapshot', () => {
  beforeEach(() => {
    postMock.mockReset();
    toastErrorMock.mockReset();
  });

  afterEach(() => {
    cleanup();
  });

  it('FAILURE: restores the queue cache to deep-equal the pre-mutation snapshot and toasts the mapped error', async () => {
    await fc.assert(
      fc.asyncProperty(scenarioArb, async (scenario) => {
        postMock.mockReset();
        toastErrorMock.mockReset();

        const error = new ApiError('QUEUE_NO_WAITING', 'No one is waiting', undefined, 409);
        postMock.mockRejectedValue(error);

        const client = createTestQueryClient();
        const queueKey = queryKeys.queue(scenario.status.organizationId, scenario.scopeServiceId);
        // Snapshot taken BEFORE the optimistic patch, fully detached from the cache
        // so an in-place mutation by the hooks could not mask a rollback failure.
        const snapshotBefore = structuredClone(scenario.status);
        client.setQueryData<QueueStatusResponse>(queueKey, structuredClone(scenario.status));

        const { result } = renderHook(
          () =>
            useServingHooks({
              orgId: scenario.status.organizationId,
              scopeServiceId: scenario.scopeServiceId,
            }),
          { wrapper: makeWrapper(client) },
        );

        await act(async () => {
          await expect(runAction(result.current, scenario)).rejects.toBeInstanceOf(ApiError);
        });

        // R6.11: the cache is rolled back to deep-equal the pre-mutation snapshot.
        expect(client.getQueryData<QueueStatusResponse>(queueKey)).toEqual(snapshotBefore);
        // R6.11: an error message mapped from the error code is shown.
        expect(toastErrorMock).toHaveBeenCalledWith(getErrorMessage(error));

        cleanup();
        client.clear();
      }),
      { numRuns: 150 },
    );
  });

  it('SUCCESS: applies the optimistic patch and schedules a reconcile (invalidation) of the queue key', async () => {
    await fc.assert(
      fc.asyncProperty(scenarioArb, async (scenario) => {
        postMock.mockReset();
        toastErrorMock.mockReset();

        const serverTicket = { id: scenario.ticketId, position: 1 };
        postMock.mockResolvedValue({ data: serverTicket });

        const client = createTestQueryClient();
        const queueKey = queryKeys.queue(scenario.status.organizationId, scenario.scopeServiceId);
        const snapshotBefore = structuredClone(scenario.status);
        client.setQueryData<QueueStatusResponse>(queueKey, structuredClone(scenario.status));

        const { result } = renderHook(
          () =>
            useServingHooks({
              orgId: scenario.status.organizationId,
              scopeServiceId: scenario.scopeServiceId,
            }),
          { wrapper: makeWrapper(client) },
        );

        await act(async () => {
          await runAction(result.current, scenario);
        });

        // R6.10: the optimistic patch (recomputed independently) is in the cache.
        const expected = expectedOptimistic(snapshotBefore, scenario);
        expect(client.getQueryData<QueueStatusResponse>(queueKey)).toEqual(expected);
        // R6.10: a server/socket reconcile is scheduled — the queue key is invalidated.
        expect(isInvalidated(client, queueKey)).toBe(true);
        // No rollback / error toast on the success path.
        expect(toastErrorMock).not.toHaveBeenCalled();

        cleanup();
        client.clear();
      }),
      { numRuns: 150 },
    );
  });
});
