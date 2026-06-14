import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ERROR_CODES } from '@queuenow/shared-constants';

import { AuthForbiddenException } from '../../common/exceptions/auth-forbidden.exception';
import type { PrismaService } from '../../prisma/prisma.service';
import type { PlanLimitsService } from '../plan/plan-limits.service';
import { QueueService } from './queue.service';
import type { QueueGateway } from './queue.gateway';
import type { CancelTicketDto } from './dto';

/**
 * Unit tests for `QueueService.cancelTicket` — the public, ownership-scoped
 * leave/cancel path added in task 16.1 (POST
 * /organizations/:orgId/queue/ticket/:ticketId/cancel).
 *
 * Validates: Requirements 11.2 (ownership-scoped cancel transitions the
 * caller's own WAITING ticket out of the active queue) and 11.4 (non-WAITING
 * tickets are rejected with QUEUE_INVALID_STATUS).
 *
 * Prisma + QueueGateway are mocked in the same style as
 * `queue-daily-volume.test.ts` so the cancel decision path is validated in
 * isolation. `PlanLimitsService` is irrelevant to cancellation and is supplied
 * as an inert stub only to satisfy the constructor.
 */

const ORG_ID = 'org-1';
const TICKET_ID = 'ticket-1';
const SERVICE_ID = 'svc-1';
const FINGERPRINT = 'device-fp-abc';
const PROFILE_ID = '550e8400-e29b-41d4-a716-446655440000';

type TicketStatus = 'WAITING' | 'CALLED' | 'SERVING' | 'COMPLETED' | 'SKIPPED';

interface StoredTicketStub {
  status?: TicketStatus;
  deviceFingerprint?: string | null;
  customerProfileId?: string | null;
}

interface CancelHarness {
  queueService: QueueService;
  findFirst: jest.Mock;
  update: jest.Mock;
  updateMany: jest.Mock;
  emitQueueUpdate: jest.Mock;
}

/**
 * Builds a QueueService whose Prisma stub returns the given stored ticket from
 * `queueTicket.findFirst`. Passing `null` simulates an unknown ticket.
 */
function buildHarness(stored: StoredTicketStub | null): CancelHarness {
  const storedTicket =
    stored === null
      ? null
      : {
          id: TICKET_ID,
          orgId: ORG_ID,
          serviceId: SERVICE_ID,
          ticketNumber: 'A001',
          status: stored.status ?? 'WAITING',
          deviceFingerprint:
            stored.deviceFingerprint === undefined ? FINGERPRINT : stored.deviceFingerprint,
          customerProfileId:
            stored.customerProfileId === undefined ? null : stored.customerProfileId,
        };

  const findFirst = jest.fn().mockResolvedValue(storedTicket);
  // `update` echoes back a realistic SKIPPED ticket so the gateway emit payload
  // can read ticketNumber/serviceId.
  const update = jest.fn().mockResolvedValue({
    id: TICKET_ID,
    orgId: ORG_ID,
    serviceId: SERVICE_ID,
    ticketNumber: 'A001',
    status: 'SKIPPED',
    skippedAt: new Date(),
    service: { id: SERVICE_ID, name: 'Consultation', prefix: 'A' },
    counter: null,
  });
  const updateMany = jest.fn().mockResolvedValue({ count: 1 });

  const prisma = {
    queueTicket: { findFirst, update },
    dailyQueueCounter: { updateMany },
  } as unknown as PrismaService;

  const emitQueueUpdate = jest.fn();
  const queueGateway = {
    emitQueueUpdate,
    emitTicketCalled: jest.fn(),
  } as unknown as QueueGateway;

  const planLimits = {
    assertWithinDailyQueueLimit: jest.fn(),
  } as unknown as PlanLimitsService;

  return {
    queueService: new QueueService(prisma, queueGateway, planLimits),
    findFirst,
    update,
    updateMany,
    emitQueueUpdate,
  };
}

describe('QueueService.cancelTicket — ownership acceptance (R11.2)', () => {
  it('cancels a WAITING ticket when the deviceFingerprint matches', async () => {
    const harness = buildHarness({
      status: 'WAITING',
      deviceFingerprint: FINGERPRINT,
      customerProfileId: null,
    });
    const dto: CancelTicketDto = { deviceFingerprint: FINGERPRINT };

    const result = await harness.queueService.cancelTicket(ORG_ID, TICKET_ID, dto);

    // Transitions out of the active queue (SKIPPED per 16.1) with skippedAt set.
    expect(result.status).toBe('SKIPPED');
    expect(harness.update).toHaveBeenCalledTimes(1);
    const updateArgs = harness.update.mock.calls[0][0] as {
      where: { id: string };
      data: { status: string; skippedAt: Date };
    };
    expect(updateArgs.where).toEqual({ id: TICKET_ID });
    expect(updateArgs.data.status).toBe('SKIPPED');
    expect(updateArgs.data.skippedAt).toBeInstanceOf(Date);

    // Daily totalSkipped incremented for the ticket's service.
    expect(harness.updateMany).toHaveBeenCalledTimes(1);
    const updateManyArgs = harness.updateMany.mock.calls[0][0] as {
      where: { orgId: string; serviceId: string };
      data: { totalSkipped: { increment: number } };
    };
    expect(updateManyArgs.where.orgId).toBe(ORG_ID);
    expect(updateManyArgs.where.serviceId).toBe(SERVICE_ID);
    expect(updateManyArgs.data.totalSkipped).toEqual({ increment: 1 });

    // Realtime cancellation event emitted.
    expect(harness.emitQueueUpdate).toHaveBeenCalledTimes(1);
    const [emitOrgId, payload] = harness.emitQueueUpdate.mock.calls[0] as [
      string,
      { type: string; ticket: { id: string; status: string } },
    ];
    expect(emitOrgId).toBe(ORG_ID);
    expect(payload.type).toBe('TICKET_CANCELLED');
    expect(payload.ticket).toMatchObject({ id: TICKET_ID, status: 'SKIPPED' });
  });

  it('cancels a WAITING ticket when the customerProfileId matches', async () => {
    const harness = buildHarness({
      status: 'WAITING',
      deviceFingerprint: null,
      customerProfileId: PROFILE_ID,
    });
    const dto: CancelTicketDto = { customerProfileId: PROFILE_ID };

    const result = await harness.queueService.cancelTicket(ORG_ID, TICKET_ID, dto);

    expect(result.status).toBe('SKIPPED');
    expect(harness.update).toHaveBeenCalledTimes(1);
    expect(harness.updateMany).toHaveBeenCalledTimes(1);
    expect(harness.emitQueueUpdate).toHaveBeenCalledTimes(1);
  });
});

describe('QueueService.cancelTicket — ownership rejection (AUTH_FORBIDDEN)', () => {
  it('rejects when neither the fingerprint nor the profile matches', async () => {
    const harness = buildHarness({
      status: 'WAITING',
      deviceFingerprint: FINGERPRINT,
      customerProfileId: PROFILE_ID,
    });
    const dto: CancelTicketDto = {
      deviceFingerprint: 'wrong-fp',
      customerProfileId: '00000000-0000-0000-0000-000000000000',
    };

    await expect(harness.queueService.cancelTicket(ORG_ID, TICKET_ID, dto)).rejects.toBeInstanceOf(
      AuthForbiddenException,
    );

    // No mutation or event on a rejected ownership check.
    expect(harness.update).not.toHaveBeenCalled();
    expect(harness.updateMany).not.toHaveBeenCalled();
    expect(harness.emitQueueUpdate).not.toHaveBeenCalled();
  });

  it('surfaces the AUTH_FORBIDDEN error code on the response envelope', async () => {
    const harness = buildHarness({
      status: 'WAITING',
      deviceFingerprint: FINGERPRINT,
      customerProfileId: null,
    });
    const dto: CancelTicketDto = { deviceFingerprint: 'wrong-fp' };

    try {
      await harness.queueService.cancelTicket(ORG_ID, TICKET_ID, dto);
      throw new Error('expected AuthForbiddenException');
    } catch (error) {
      expect(error).toBeInstanceOf(AuthForbiddenException);
      const response = (error as AuthForbiddenException).getResponse() as { code: string };
      expect(response.code).toBe(ERROR_CODES.AUTH_FORBIDDEN);
      expect((error as AuthForbiddenException).getStatus()).toBe(403);
    }
  });

  it('never authorizes against a null stored fingerprint even when the dto omits it', async () => {
    // Stored ticket has no ownership identifiers at all. An empty dto must not
    // satisfy the check via null == null / undefined == undefined.
    const harness = buildHarness({
      status: 'WAITING',
      deviceFingerprint: null,
      customerProfileId: null,
    });
    const dto: CancelTicketDto = {};

    await expect(harness.queueService.cancelTicket(ORG_ID, TICKET_ID, dto)).rejects.toBeInstanceOf(
      AuthForbiddenException,
    );
    expect(harness.update).not.toHaveBeenCalled();
  });

  it('never authorizes a provided identifier against a null stored value', async () => {
    // dto supplies identifiers, but the stored ticket stored none — a missing
    // stored value must never authorize.
    const harness = buildHarness({
      status: 'WAITING',
      deviceFingerprint: null,
      customerProfileId: null,
    });
    const dto: CancelTicketDto = {
      deviceFingerprint: FINGERPRINT,
      customerProfileId: PROFILE_ID,
    };

    await expect(harness.queueService.cancelTicket(ORG_ID, TICKET_ID, dto)).rejects.toBeInstanceOf(
      AuthForbiddenException,
    );
    expect(harness.update).not.toHaveBeenCalled();
  });
});

describe('QueueService.cancelTicket — non-WAITING rejection (R11.4)', () => {
  const NON_WAITING_STATUSES: TicketStatus[] = ['CALLED', 'SERVING', 'COMPLETED', 'SKIPPED'];

  it.each(NON_WAITING_STATUSES)(
    'rejects a %s ticket with QUEUE_INVALID_STATUS even for a verified owner',
    async (status) => {
      const harness = buildHarness({
        status,
        deviceFingerprint: FINGERPRINT,
        customerProfileId: null,
      });
      const dto: CancelTicketDto = { deviceFingerprint: FINGERPRINT };

      await expect(
        harness.queueService.cancelTicket(ORG_ID, TICKET_ID, dto),
      ).rejects.toBeInstanceOf(BadRequestException);

      try {
        await harness.queueService.cancelTicket(ORG_ID, TICKET_ID, dto);
        throw new Error('expected BadRequestException');
      } catch (error) {
        expect(error).toBeInstanceOf(BadRequestException);
        const response = (error as BadRequestException).getResponse() as { code: string };
        expect(response.code).toBe(ERROR_CODES.QUEUE_INVALID_STATUS);
      }

      // No state transition or event for a non-WAITING ticket.
      expect(harness.update).not.toHaveBeenCalled();
      expect(harness.updateMany).not.toHaveBeenCalled();
      expect(harness.emitQueueUpdate).not.toHaveBeenCalled();
    },
  );
});

describe('QueueService.cancelTicket — not found', () => {
  it('throws NotFoundException for an unknown ticket', async () => {
    const harness = buildHarness(null);
    const dto: CancelTicketDto = { deviceFingerprint: FINGERPRINT };

    await expect(harness.queueService.cancelTicket(ORG_ID, TICKET_ID, dto)).rejects.toBeInstanceOf(
      NotFoundException,
    );

    expect(harness.findFirst).toHaveBeenCalledWith({
      where: { id: TICKET_ID, orgId: ORG_ID },
    });
    expect(harness.update).not.toHaveBeenCalled();
  });
});
