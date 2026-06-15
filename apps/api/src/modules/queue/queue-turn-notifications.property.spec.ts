import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { NotificationType } from '@queuenow/shared-types';
import fc from 'fast-check';

import type { IAuthenticatedUser } from '../../common/interfaces';
import type { PrismaService } from '../../prisma/prisma.service';
import type { PlanLimitsService } from '../plan/plan-limits.service';
import type { NotificationService } from '../notification/notification.service';
import { QueueService } from './queue.service';
import type { QueueGateway } from './queue.gateway';

/**
 * Property-based tests for the queue-turn-notifications bugfix.
 *
 * Harness style mirrors `queue-cancel-ticket.test.ts` / `queue-daily-volume.test.ts`:
 * `QueueService` is constructed directly with a mocked `PrismaService`, a mocked
 * `QueueGateway` (here extended with `emitTicketNotification: jest.fn()` alongside
 * the existing `emitQueueUpdate` / `emitTicketCalled`), a `PlanLimitsService` stub,
 * and a mocked `NotificationService` exposing
 * `sendNotification: jest.fn().mockResolvedValue(undefined)`.
 *
 * CONSTRUCTOR NOTE (4-arg vs current 3-arg):
 * The FIXED `QueueService` constructor takes four args —
 * `(prisma, queueGateway, planLimits, notificationService)` — but the current
 * UNFIXED code only declares three `(prisma, queueGateway, planLimits)`. To keep
 * BOTH properties runnable against the unfixed code (extra constructor args are
 * simply ignored at runtime by JS), we construct via a typed constructor cast
 * (`buildQueueService`) that always passes all four args. This compiles against
 * the current 3-arg signature and runs against the future 4-arg signature
 * unchanged. Property 1 is therefore EXPECTED TO FAIL on the unfixed code on its
 * assertions (the turn-alert wiring is absent), while Property 2 is EXPECTED TO
 * PASS (the pre-existing emissions/return shapes are untouched by the cast).
 */

const ORG_ID = 'org-1';
const COUNTER_ID = 'counter-1';
const COUNTER_NAME = 'Counter 1';
const SERVICE_ID = 'svc-1';
const SERVICE_NAME = 'Consultation';
const TICKET_ID = 'ticket-1';
const NEXT_ID = 'ticket-2';
const PROFILE_ID = '550e8400-e29b-41d4-a716-446655440000';
const NEXT_PROFILE_ID = '550e8400-e29b-41d4-a716-446655440001';

const STAFF: IAuthenticatedUser = { id: 'staff-1', orgId: ORG_ID } as IAuthenticatedUser;
const OTHER_ORG_STAFF: IAuthenticatedUser = {
  id: 'staff-9',
  orgId: 'org-other',
} as IAuthenticatedUser;

type ServingAction = 'CALL_NEXT' | 'RECALL' | 'SKIP';

interface GatewayMocks {
  emitQueueUpdate: jest.Mock;
  emitTicketCalled: jest.Mock;
  emitTicketNotification: jest.Mock;
}

/**
 * Defensive 4-arg construction (see CONSTRUCTOR NOTE above). The cast lets the
 * spec target the FIXED 4-arg signature while still compiling/running against the
 * current 3-arg `QueueService`, whose runtime ignores the surplus argument.
 */
type QueueServiceCtor = new (
  prisma: PrismaService,
  queueGateway: QueueGateway,
  planLimits: PlanLimitsService,
  notificationService: NotificationService,
) => QueueService;

function buildQueueService(
  prisma: PrismaService,
  queueGateway: QueueGateway,
  planLimits: PlanLimitsService,
  notificationService: NotificationService,
): QueueService {
  const Ctor = QueueService as unknown as QueueServiceCtor;
  return new Ctor(prisma, queueGateway, planLimits, notificationService);
}

function makeGateway(deliveryThrows = false): { gateway: QueueGateway; mocks: GatewayMocks } {
  const emitQueueUpdate = jest.fn();
  const emitTicketCalled = jest.fn();
  const emitTicketNotification = jest.fn();
  if (deliveryThrows) {
    emitTicketNotification.mockImplementation(() => {
      throw new Error('socket delivery failed');
    });
  }
  const gateway = {
    emitQueueUpdate,
    emitTicketCalled,
    emitTicketNotification,
  } as unknown as QueueGateway;
  return { gateway, mocks: { emitQueueUpdate, emitTicketCalled, emitTicketNotification } };
}

function makeNotificationService(deliveryThrows = false): {
  notificationService: NotificationService;
  sendNotification: jest.Mock;
} {
  const sendNotification = deliveryThrows
    ? jest.fn().mockRejectedValue(new Error('push delivery failed'))
    : jest.fn().mockResolvedValue(undefined);
  const notificationService = { sendNotification } as unknown as NotificationService;
  return { notificationService, sendNotification };
}

function makePlanLimits(): PlanLimitsService {
  return {
    assertWithinDailyQueueLimit: jest.fn().mockResolvedValue(undefined),
  } as unknown as PlanLimitsService;
}

/** Updated-ticket shape returned by `queueTicket.update` (includes scalar fields + relations). */
function makeUpdatedTicket(
  status: 'CALLED' | 'SKIPPED' | 'COMPLETED' | 'WAITING',
  customerProfileId: string | null,
): Record<string, unknown> {
  return {
    id: TICKET_ID,
    orgId: ORG_ID,
    serviceId: SERVICE_ID,
    ticketNumber: 'A001',
    status,
    customerProfileId,
    recallCount: status === 'CALLED' ? 1 : 0,
    service: { id: SERVICE_ID, name: SERVICE_NAME, prefix: 'A' },
    counter: { id: COUNTER_ID, name: COUNTER_NAME },
    calledBy: { id: STAFF.id, fullName: 'Staff One' },
  };
}

interface ServingHarnessOptions {
  action: ServingAction;
  affectedProfiled: boolean;
  nextPresent?: boolean;
  nextProfiled?: boolean;
  deliveryThrows?: boolean;
}

interface ServingHarness {
  run: () => Promise<unknown>;
  updatedTicket: Record<string, unknown>;
  gateway: GatewayMocks;
  sendNotification: jest.Mock;
}

/**
 * Builds a `QueueService` driven through a single successful serving transition
 * for the given action, with all Prisma reads/writes mocked to succeed.
 */
function buildServingHarness(opts: ServingHarnessOptions): ServingHarness {
  const { action, affectedProfiled, nextPresent, nextProfiled, deliveryThrows } = opts;
  const { gateway, mocks } = makeGateway(deliveryThrows);
  const { notificationService, sendNotification } = makeNotificationService(deliveryThrows);
  const planLimits = makePlanLimits();

  const affectedProfileId = affectedProfiled ? PROFILE_ID : null;
  let updatedTicket: Record<string, unknown>;
  let prisma: PrismaService;

  if (action === 'CALL_NEXT') {
    updatedTicket = makeUpdatedTicket('CALLED', affectedProfileId);
    const counterFindFirst = jest.fn().mockResolvedValue({
      id: COUNTER_ID,
      orgId: ORG_ID,
      isActive: true,
      serviceId: SERVICE_ID,
      name: COUNTER_NAME,
      service: { id: SERVICE_ID, name: SERVICE_NAME },
    });
    const nextWaiting = nextPresent
      ? { id: NEXT_ID, customerProfileId: nextProfiled ? NEXT_PROFILE_ID : null }
      : null;
    // findFirst #1: the front-of-line WAITING ticket to call.
    // findFirst #2 (fix only): the new front-of-line WAITING ticket for ALMOST_TURN.
    const ticketFindFirst = jest
      .fn()
      .mockResolvedValueOnce({
        id: TICKET_ID,
        orgId: ORG_ID,
        serviceId: SERVICE_ID,
        status: 'WAITING',
      })
      .mockResolvedValue(nextWaiting);
    const ticketUpdate = jest.fn().mockResolvedValue(updatedTicket);
    prisma = {
      counter: { findFirst: counterFindFirst },
      queueTicket: { findFirst: ticketFindFirst, update: ticketUpdate },
      dailyQueueCounter: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
    } as unknown as PrismaService;
  } else if (action === 'RECALL') {
    updatedTicket = makeUpdatedTicket('CALLED', affectedProfileId);
    const ticketFindFirst = jest.fn().mockResolvedValue({
      id: TICKET_ID,
      orgId: ORG_ID,
      serviceId: SERVICE_ID,
      status: 'CALLED',
      recallCount: 0,
      counter: { id: COUNTER_ID, name: COUNTER_NAME },
    });
    const ticketUpdate = jest.fn().mockResolvedValue(updatedTicket);
    prisma = {
      queueTicket: { findFirst: ticketFindFirst, update: ticketUpdate },
      queueSettings: { findUnique: jest.fn().mockResolvedValue({ maxRecall: 2 }) },
    } as unknown as PrismaService;
  } else {
    // SKIP
    updatedTicket = makeUpdatedTicket('SKIPPED', affectedProfileId);
    const ticketFindFirst = jest.fn().mockResolvedValue({
      id: TICKET_ID,
      orgId: ORG_ID,
      serviceId: SERVICE_ID,
      status: 'CALLED',
    });
    const ticketUpdate = jest.fn().mockResolvedValue(updatedTicket);
    prisma = {
      queueTicket: { findFirst: ticketFindFirst, update: ticketUpdate },
      dailyQueueCounter: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
    } as unknown as PrismaService;
  }

  const service = buildQueueService(prisma, gateway, planLimits, notificationService);

  const run = (): Promise<unknown> => {
    switch (action) {
      case 'CALL_NEXT':
        return service.callNext(ORG_ID, { counterId: COUNTER_ID }, STAFF);
      case 'RECALL':
        return service.recall(ORG_ID, TICKET_ID, STAFF);
      case 'SKIP':
        return service.skip(ORG_ID, TICKET_ID, STAFF);
    }
  };

  return { run, updatedTicket, gateway: mocks, sendNotification };
}

function expectedAlertType(action: ServingAction): NotificationType {
  return action === 'SKIP' ? NotificationType.SKIPPED : NotificationType.YOUR_TURN;
}

// ---------------------------------------------------------------------------
// Feature: queue-turn-notifications, Property 1: every callNext/recall/skip
// transition that should alert invokes emitTicketNotification (and
// sendNotification when the affected ticket is profiled), and callNext alerts
// the next WAITING ticket with ALMOST_TURN
// Validates: Requirements 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7, 2.8, 2.9, 2.10, 2.11
//
// EXPECTED OUTCOME on UNFIXED code: FAILS. The producer wiring is absent —
// emitTicketNotification and sendNotification are never called from
// QueueService — so the call-pattern assertions fail. This failure confirms the
// bug (missing call sites). DO NOT weaken this test or change production code to
// make it pass here; it becomes the fix-checking test in task 3.5.
// ---------------------------------------------------------------------------
describe('Property 1: Bug Condition — serving actions produce the correct turn-alert', () => {
  it('alerts the affected ticket (and next WAITING for callNext) across the bug-condition domain', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.record({
          action: fc.constantFrom<ServingAction>('CALL_NEXT', 'RECALL', 'SKIP'),
          affectedProfiled: fc.boolean(),
          nextPresent: fc.boolean(),
          nextProfiled: fc.boolean(),
          deliveryThrows: fc.boolean(),
        }),
        async ({ action, affectedProfiled, nextPresent, nextProfiled, deliveryThrows }) => {
          const harness = buildServingHarness({
            action,
            affectedProfiled,
            nextPresent,
            nextProfiled,
            deliveryThrows,
          });

          // R2.8: the queue action resolves with the updated ticket even when a
          // delivery throws/rejects.
          const result = await harness.run();
          expect(result).toBe(harness.updatedTicket);

          const expectedType = expectedAlertType(action);
          const notifCalls = harness.gateway.emitTicketNotification.mock.calls as Array<
            [string, Record<string, unknown>]
          >;
          const sendCalls = harness.sendNotification.mock.calls as Array<[string, string, string]>;

          // R2.1/R2.3/R2.4: the affected ticket receives exactly one socket alert
          // of the expected type (YOUR_TURN carries counterName; SKIPPED does not).
          const affectedNotif = notifCalls.filter((c) => c[0] === TICKET_ID);
          expect(affectedNotif).toHaveLength(1); // also enforces R2.7 (one per type)
          if (expectedType === NotificationType.YOUR_TURN) {
            expect(affectedNotif[0][1]).toEqual({
              type: NotificationType.YOUR_TURN,
              counterName: COUNTER_NAME,
            });
          } else {
            expect(affectedNotif[0][1]).toEqual({ type: NotificationType.SKIPPED });
          }

          // R2.2/R2.9/R2.10/R2.11: push fires iff the affected ticket is profiled.
          const affectedSend = sendCalls.filter((c) => c[0] === TICKET_ID);
          if (affectedProfiled) {
            expect(affectedSend).toHaveLength(1);
            expect(affectedSend[0]).toEqual([TICKET_ID, PROFILE_ID, expectedType]);
          } else {
            expect(affectedSend).toHaveLength(0);
          }

          // R2.5/R2.6: callNext alerts the next WAITING ticket with ALMOST_TURN
          // when one exists, and produces no ALMOST_TURN when none exists.
          const nextNotif = notifCalls.filter((c) => c[0] === NEXT_ID);
          const almostTurnCalls = notifCalls.filter(
            (c) => c[1]?.type === NotificationType.ALMOST_TURN,
          );
          if (action === 'CALL_NEXT' && nextPresent) {
            expect(nextNotif).toHaveLength(1);
            expect(nextNotif[0][1]).toEqual({ type: NotificationType.ALMOST_TURN });
            const nextSend = sendCalls.filter((c) => c[0] === NEXT_ID);
            if (nextProfiled) {
              expect(nextSend).toEqual([[NEXT_ID, NEXT_PROFILE_ID, NotificationType.ALMOST_TURN]]);
            } else {
              expect(nextSend).toHaveLength(0);
            }
          } else {
            // No ALMOST_TURN for recall/skip, or for callNext with no next ticket.
            expect(almostTurnCalls).toHaveLength(0);
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});

// ---------------------------------------------------------------------------
// Feature: queue-turn-notifications, Property 2: pre-existing emissions, staff
// auth/validation, and return shapes are unchanged, and
// joinQueue/complete/rejoin/cancelTicket emit no turn-alerts
// Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7
//
// EXPECTED OUTCOME on UNFIXED code: PASSES. These encode the observed baseline
// behavior the fix must preserve (observation-first methodology).
// ---------------------------------------------------------------------------
describe('Property 2: Preservation — existing behavior is unchanged', () => {
  it('preserves emitQueueUpdate/emitTicketCalled payloads and return shape for serving actions (R3.1, R3.2, R3.5)', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.record({
          action: fc.constantFrom<ServingAction>('CALL_NEXT', 'RECALL', 'SKIP'),
          affectedProfiled: fc.boolean(),
        }),
        async ({ action, affectedProfiled }) => {
          const harness = buildServingHarness({
            action,
            affectedProfiled,
            nextPresent: true,
            nextProfiled: false,
          });

          const result = await harness.run();

          // R3.5: response shape unchanged — the updated ticket is returned as-is.
          expect(result).toBe(harness.updatedTicket);

          // R3.1: emitQueueUpdate fires exactly once with the existing payload.
          expect(harness.gateway.emitQueueUpdate).toHaveBeenCalledTimes(1);
          const [emitOrgId, payload] = harness.gateway.emitQueueUpdate.mock.calls[0] as [
            string,
            { type: string; ticket: Record<string, unknown> },
          ];
          expect(emitOrgId).toBe(ORG_ID);

          if (action === 'CALL_NEXT') {
            expect(payload).toEqual({
              type: 'TICKET_CALLED',
              ticket: {
                id: TICKET_ID,
                ticketNumber: 'A001',
                status: 'CALLED',
                counterName: COUNTER_NAME,
                serviceId: SERVICE_ID,
              },
            });
            // R3.2: queue:ticket-called preserved for callNext.
            expect(harness.gateway.emitTicketCalled).toHaveBeenCalledTimes(1);
            expect(harness.gateway.emitTicketCalled.mock.calls[0]).toEqual([
              ORG_ID,
              { ticketNumber: 'A001', counterName: COUNTER_NAME, serviceName: SERVICE_NAME },
            ]);
          } else if (action === 'RECALL') {
            expect(payload).toEqual({
              type: 'TICKET_RECALLED',
              ticket: {
                id: TICKET_ID,
                ticketNumber: 'A001',
                recallCount: 1,
                counterName: COUNTER_NAME,
                serviceId: SERVICE_ID,
              },
            });
            // R3.2: queue:ticket-called preserved for recall (incl. isRecall/recallCount).
            expect(harness.gateway.emitTicketCalled).toHaveBeenCalledTimes(1);
            expect(harness.gateway.emitTicketCalled.mock.calls[0]).toEqual([
              ORG_ID,
              {
                ticketNumber: 'A001',
                counterName: COUNTER_NAME,
                serviceName: SERVICE_NAME,
                isRecall: true,
                recallCount: 1,
              },
            ]);
          } else {
            expect(payload).toEqual({
              type: 'TICKET_SKIPPED',
              ticket: {
                id: TICKET_ID,
                ticketNumber: 'A001',
                status: 'SKIPPED',
                serviceId: SERVICE_ID,
              },
            });
            // skip never emits queue:ticket-called.
            expect(harness.gateway.emitTicketCalled).not.toHaveBeenCalled();
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it('never emits turn-alerts for joinQueue/complete/rejoin/cancelTicket (R3.3)', async () => {
    type NonTriggering = 'JOIN' | 'COMPLETE' | 'REJOIN' | 'CANCEL';

    const buildNonTriggering = (
      action: NonTriggering,
    ): { run: () => Promise<unknown>; gateway: GatewayMocks; sendNotification: jest.Mock } => {
      const { gateway, mocks } = makeGateway();
      const { notificationService, sendNotification } = makeNotificationService();
      const planLimits = makePlanLimits();

      let prisma: PrismaService;
      let run: () => Promise<unknown>;
      let service: QueueService;

      if (action === 'JOIN') {
        const tx = {
          dailyQueueCounter: { upsert: jest.fn().mockResolvedValue({ lastNumber: 1 }) },
          queueTicket: {
            create: jest.fn().mockResolvedValue({
              id: TICKET_ID,
              ticketNumber: 'A001',
              status: 'WAITING',
              serviceId: SERVICE_ID,
              createdAt: new Date(),
              service: { id: SERVICE_ID, name: SERVICE_NAME, prefix: 'A', avgServingTime: 5 },
            }),
          },
        };
        prisma = {
          organization: {
            findFirst: jest.fn().mockResolvedValue({ id: ORG_ID, isActive: true, settings: {} }),
          },
          service: {
            findFirst: jest.fn().mockResolvedValue({
              id: SERVICE_ID,
              orgId: ORG_ID,
              isActive: true,
              prefix: 'A',
              avgServingTime: 5,
              maxQueuePerDay: null,
            }),
          },
          queueTicket: { count: jest.fn().mockResolvedValue(1) },
          $transaction: jest
            .fn()
            .mockImplementation((cb: (t: typeof tx) => Promise<unknown>) => cb(tx)),
        } as unknown as PrismaService;
        service = buildQueueService(prisma, gateway, planLimits, notificationService);
        run = () => service.joinQueue(ORG_ID, { serviceId: SERVICE_ID, customerName: 'Test' });
      } else if (action === 'COMPLETE') {
        prisma = {
          queueTicket: {
            findFirst: jest.fn().mockResolvedValue({
              id: TICKET_ID,
              orgId: ORG_ID,
              serviceId: SERVICE_ID,
              status: 'CALLED',
              servingAt: null,
              calledAt: new Date(),
            }),
            update: jest.fn().mockResolvedValue(makeUpdatedTicket('COMPLETED', null)),
          },
          dailyQueueCounter: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
        } as unknown as PrismaService;
        service = buildQueueService(prisma, gateway, planLimits, notificationService);
        run = () => service.complete(ORG_ID, TICKET_ID, STAFF);
      } else if (action === 'REJOIN') {
        prisma = {
          queueTicket: {
            findFirst: jest.fn().mockResolvedValue({
              id: TICKET_ID,
              orgId: ORG_ID,
              serviceId: SERVICE_ID,
              status: 'SKIPPED',
            }),
            update: jest.fn().mockResolvedValue({
              id: TICKET_ID,
              ticketNumber: 'A001',
              serviceId: SERVICE_ID,
              status: 'WAITING',
              createdAt: new Date(),
              service: { id: SERVICE_ID, name: SERVICE_NAME, prefix: 'A' },
            }),
            count: jest.fn().mockResolvedValue(1),
          },
          dailyQueueCounter: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
        } as unknown as PrismaService;
        service = buildQueueService(prisma, gateway, planLimits, notificationService);
        run = () => service.rejoin(ORG_ID, TICKET_ID, STAFF);
      } else {
        // CANCEL
        prisma = {
          queueTicket: {
            findFirst: jest.fn().mockResolvedValue({
              id: TICKET_ID,
              orgId: ORG_ID,
              serviceId: SERVICE_ID,
              status: 'WAITING',
              deviceFingerprint: 'device-fp',
              customerProfileId: null,
            }),
            update: jest.fn().mockResolvedValue(makeUpdatedTicket('SKIPPED', null)),
          },
          dailyQueueCounter: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
        } as unknown as PrismaService;
        service = buildQueueService(prisma, gateway, planLimits, notificationService);
        run = () => service.cancelTicket(ORG_ID, TICKET_ID, { deviceFingerprint: 'device-fp' });
      }

      return { run, gateway: mocks, sendNotification };
    };

    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom<NonTriggering>('JOIN', 'COMPLETE', 'REJOIN', 'CANCEL'),
        async (action) => {
          const harness = buildNonTriggering(action);
          await harness.run();
          // R3.3: no turn-alert side effects on these actions.
          expect(harness.gateway.emitTicketNotification).not.toHaveBeenCalled();
          expect(harness.sendNotification).not.toHaveBeenCalled();
        },
      ),
      { numRuns: 100 },
    );
  });

  it('preserves auth/validation: forbidden-org, not-found, and max-recall throw before any transition (R3.4)', async () => {
    type AuthFailure = 'FORBIDDEN_ORG' | 'COUNTER_NOT_FOUND' | 'TICKET_NOT_FOUND' | 'MAX_RECALL';

    const buildAuthFailure = (
      scenario: AuthFailure,
    ): {
      run: () => Promise<unknown>;
      expected: typeof ForbiddenException | typeof NotFoundException | typeof BadRequestException;
      gateway: GatewayMocks;
      sendNotification: jest.Mock;
      update: jest.Mock;
    } => {
      const { gateway, mocks } = makeGateway();
      const { notificationService, sendNotification } = makeNotificationService();
      const planLimits = makePlanLimits();
      const update = jest.fn();

      let prisma: PrismaService;
      let run: () => Promise<unknown>;
      let expected:
        | typeof ForbiddenException
        | typeof NotFoundException
        | typeof BadRequestException;
      let service: QueueService;

      if (scenario === 'FORBIDDEN_ORG') {
        prisma = {
          counter: { findFirst: jest.fn() },
          queueTicket: { findFirst: jest.fn(), update },
        } as unknown as PrismaService;
        service = buildQueueService(prisma, gateway, planLimits, notificationService);
        // Staff belongs to a different org → validateStaffOrgAccess throws first.
        run = () => service.callNext(ORG_ID, { counterId: COUNTER_ID }, OTHER_ORG_STAFF);
        expected = ForbiddenException;
      } else if (scenario === 'COUNTER_NOT_FOUND') {
        prisma = {
          counter: { findFirst: jest.fn().mockResolvedValue(null) },
          queueTicket: { findFirst: jest.fn(), update },
        } as unknown as PrismaService;
        service = buildQueueService(prisma, gateway, planLimits, notificationService);
        run = () => service.callNext(ORG_ID, { counterId: COUNTER_ID }, STAFF);
        expected = NotFoundException;
      } else if (scenario === 'TICKET_NOT_FOUND') {
        // recall on a ticket not in CALLED status → findFirst returns null.
        prisma = {
          queueTicket: { findFirst: jest.fn().mockResolvedValue(null), update },
          queueSettings: { findUnique: jest.fn() },
        } as unknown as PrismaService;
        service = buildQueueService(prisma, gateway, planLimits, notificationService);
        run = () => service.recall(ORG_ID, TICKET_ID, STAFF);
        expected = NotFoundException;
      } else {
        // MAX_RECALL: recallCount already at maxRecall → BadRequestException before update.
        prisma = {
          queueTicket: {
            findFirst: jest.fn().mockResolvedValue({
              id: TICKET_ID,
              orgId: ORG_ID,
              serviceId: SERVICE_ID,
              status: 'CALLED',
              recallCount: 2,
              counter: { id: COUNTER_ID, name: COUNTER_NAME },
            }),
            update,
          },
          queueSettings: { findUnique: jest.fn().mockResolvedValue({ maxRecall: 2 }) },
        } as unknown as PrismaService;
        service = buildQueueService(prisma, gateway, planLimits, notificationService);
        run = () => service.recall(ORG_ID, TICKET_ID, STAFF);
        expected = BadRequestException;
      }

      return { run, expected, gateway: mocks, sendNotification, update };
    };

    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom<AuthFailure>(
          'FORBIDDEN_ORG',
          'COUNTER_NOT_FOUND',
          'TICKET_NOT_FOUND',
          'MAX_RECALL',
        ),
        async (scenario) => {
          const harness = buildAuthFailure(scenario);
          await expect(harness.run()).rejects.toBeInstanceOf(harness.expected);
          // No transition and no emissions of any kind when validation rejects.
          expect(harness.update).not.toHaveBeenCalled();
          expect(harness.gateway.emitQueueUpdate).not.toHaveBeenCalled();
          expect(harness.gateway.emitTicketCalled).not.toHaveBeenCalled();
          expect(harness.gateway.emitTicketNotification).not.toHaveBeenCalled();
          expect(harness.sendNotification).not.toHaveBeenCalled();
        },
      ),
      { numRuns: 100 },
    );
  });
});
