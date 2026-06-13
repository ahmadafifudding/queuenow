import { Test, TestingModule } from '@nestjs/testing';
import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { QueueService } from './queue.service';
import { QueueGateway } from './queue.gateway';
import { PrismaService } from '../../prisma/prisma.service';
import { IAuthenticatedUser } from '../../common/interfaces';

describe('QueueService', () => {
  let service: QueueService;

  const ORG_ID = 'org-id';

  const staffUser: IAuthenticatedUser = {
    id: 'user-id',
    email: 'staff@example.com',
    fullName: 'Staff One',
    orgId: ORG_ID,
    role: 'STAFF',
    type: 'staff',
  };

  const mockPrisma = {
    organization: { findFirst: jest.fn() },
    service: { findFirst: jest.fn() },
    counter: { findFirst: jest.fn() },
    queueSettings: { findUnique: jest.fn() },
    dailyQueueCounter: { upsert: jest.fn(), updateMany: jest.fn() },
    queueTicket: {
      count: jest.fn(),
      create: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn(),
      update: jest.fn(),
    },
  };

  const mockGateway = {
    emitQueueUpdate: jest.fn(),
    emitTicketCalled: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        QueueService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: QueueGateway, useValue: mockGateway },
      ],
    }).compile();

    service = module.get<QueueService>(QueueService);
  });

  describe('joinQueue', () => {
    const dto = { serviceId: 'service-id', customerName: 'Alice' };

    it('should create a ticket with a prefixed number and return position', async () => {
      mockPrisma.organization.findFirst.mockResolvedValue({
        id: ORG_ID,
        settings: {},
      });
      mockPrisma.service.findFirst.mockResolvedValue({
        id: 'service-id',
        prefix: 'A',
        maxQueuePerDay: null,
        avgServingTime: 5,
      });
      mockPrisma.dailyQueueCounter.upsert.mockResolvedValue({ lastNumber: 7 });
      const createdAt = new Date();
      mockPrisma.queueTicket.create.mockResolvedValue({
        id: 'ticket-id',
        ticketNumber: 'A007',
        createdAt,
      });
      mockPrisma.queueTicket.count.mockResolvedValue(3);

      const result = await service.joinQueue(ORG_ID, dto);

      expect(mockPrisma.queueTicket.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            ticketNumber: 'A007',
            dailyNumber: 7,
            status: 'WAITING',
          }),
        }),
      );
      expect(result.position).toBe(3);
      expect(result.estimatedWaitMinutes).toBe(10); // (3 - 1) * 5
      expect(mockGateway.emitQueueUpdate).toHaveBeenCalledWith(
        ORG_ID,
        expect.objectContaining({ type: 'TICKET_JOINED' }),
      );
    });

    it('should throw NotFoundException when organization is inactive or missing', async () => {
      mockPrisma.organization.findFirst.mockResolvedValue(null);

      await expect(service.joinQueue(ORG_ID, dto)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('should throw NotFoundException when service is missing', async () => {
      mockPrisma.organization.findFirst.mockResolvedValue({ id: ORG_ID });
      mockPrisma.service.findFirst.mockResolvedValue(null);

      await expect(service.joinQueue(ORG_ID, dto)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('should throw BadRequestException when the daily limit is reached', async () => {
      mockPrisma.organization.findFirst.mockResolvedValue({ id: ORG_ID });
      mockPrisma.service.findFirst.mockResolvedValue({
        id: 'service-id',
        prefix: 'A',
        maxQueuePerDay: 50,
        avgServingTime: 5,
      });
      mockPrisma.queueTicket.count.mockResolvedValue(50);

      await expect(service.joinQueue(ORG_ID, dto)).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(mockPrisma.queueTicket.create).not.toHaveBeenCalled();
    });
  });

  describe('callNext', () => {
    const dto = { counterId: 'counter-id' };

    it('should deny access when user belongs to a different organization', async () => {
      await expect(
        service.callNext('other-org', dto, staffUser),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('should throw NotFoundException when the counter is missing', async () => {
      mockPrisma.counter.findFirst.mockResolvedValue(null);

      await expect(service.callNext(ORG_ID, dto, staffUser)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('should throw NotFoundException when no ticket is waiting', async () => {
      mockPrisma.counter.findFirst.mockResolvedValue({
        id: 'counter-id',
        serviceId: 'service-id',
        name: 'Counter 1',
        service: { name: 'General' },
      });
      mockPrisma.queueTicket.findFirst.mockResolvedValue(null);

      await expect(service.callNext(ORG_ID, dto, staffUser)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('should call the oldest waiting ticket and emit events', async () => {
      mockPrisma.counter.findFirst.mockResolvedValue({
        id: 'counter-id',
        serviceId: 'service-id',
        name: 'Counter 1',
        service: { name: 'General' },
      });
      mockPrisma.queueTicket.findFirst.mockResolvedValue({ id: 'ticket-id' });
      mockPrisma.queueTicket.update.mockResolvedValue({
        id: 'ticket-id',
        ticketNumber: 'A001',
      });

      const result = await service.callNext(ORG_ID, dto, staffUser);

      expect(mockPrisma.queueTicket.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ orderBy: { createdAt: 'asc' } }),
      );
      expect(mockPrisma.queueTicket.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'ticket-id' },
          data: expect.objectContaining({ status: 'CALLED', counterId: 'counter-id' }),
        }),
      );
      expect(mockGateway.emitTicketCalled).toHaveBeenCalled();
      expect(result.ticketNumber).toBe('A001');
    });
  });

  describe('recall', () => {
    it('should throw BadRequestException when the max recall limit is reached', async () => {
      mockPrisma.queueTicket.findFirst.mockResolvedValue({
        id: 'ticket-id',
        recallCount: 2,
        counter: { name: 'Counter 1' },
      });
      mockPrisma.queueSettings.findUnique.mockResolvedValue({ maxRecall: 2 });

      await expect(
        service.recall(ORG_ID, 'ticket-id', staffUser),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(mockPrisma.queueTicket.update).not.toHaveBeenCalled();
    });

    it('should increment recall count and emit a recall event', async () => {
      mockPrisma.queueTicket.findFirst.mockResolvedValue({
        id: 'ticket-id',
        recallCount: 0,
        counter: { name: 'Counter 1' },
      });
      mockPrisma.queueSettings.findUnique.mockResolvedValue({ maxRecall: 2 });
      mockPrisma.queueTicket.update.mockResolvedValue({
        id: 'ticket-id',
        ticketNumber: 'A001',
        recallCount: 1,
        serviceId: 'service-id',
        service: { name: 'General' },
      });

      const result = await service.recall(ORG_ID, 'ticket-id', staffUser);

      expect(mockPrisma.queueTicket.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { recallCount: { increment: 1 } },
        }),
      );
      expect(result.recallCount).toBe(1);
      expect(mockGateway.emitTicketCalled).toHaveBeenCalledWith(
        expect.objectContaining({ isRecall: true }),
      );
    });

    it('should throw NotFoundException when the ticket is not in CALLED status', async () => {
      mockPrisma.queueTicket.findFirst.mockResolvedValue(null);

      await expect(
        service.recall(ORG_ID, 'ticket-id', staffUser),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('skip', () => {
    it('should set the ticket to SKIPPED and bump the daily skip counter', async () => {
      mockPrisma.queueTicket.findFirst.mockResolvedValue({
        id: 'ticket-id',
        serviceId: 'service-id',
      });
      mockPrisma.queueTicket.update.mockResolvedValue({
        id: 'ticket-id',
        ticketNumber: 'A001',
        status: 'SKIPPED',
        serviceId: 'service-id',
      });
      mockPrisma.dailyQueueCounter.updateMany.mockResolvedValue({ count: 1 });

      const result = await service.skip(ORG_ID, 'ticket-id', staffUser);

      expect(result.status).toBe('SKIPPED');
      expect(mockPrisma.dailyQueueCounter.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({ data: { totalSkipped: { increment: 1 } } }),
      );
    });

    it('should throw NotFoundException when the ticket is not in CALLED status', async () => {
      mockPrisma.queueTicket.findFirst.mockResolvedValue(null);

      await expect(
        service.skip(ORG_ID, 'ticket-id', staffUser),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('complete', () => {
    it('should set the ticket to COMPLETED and bump the served counter', async () => {
      mockPrisma.queueTicket.findFirst.mockResolvedValue({
        id: 'ticket-id',
        serviceId: 'service-id',
        servingAt: null,
        calledAt: new Date(),
      });
      mockPrisma.queueTicket.update.mockResolvedValue({
        id: 'ticket-id',
        ticketNumber: 'A001',
        status: 'COMPLETED',
        serviceId: 'service-id',
      });
      mockPrisma.dailyQueueCounter.updateMany.mockResolvedValue({ count: 1 });

      const result = await service.complete(ORG_ID, 'ticket-id', staffUser);

      expect(result.status).toBe('COMPLETED');
      expect(mockPrisma.dailyQueueCounter.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({ data: { totalServed: { increment: 1 } } }),
      );
    });
  });

  describe('rejoin', () => {
    it('should reset a skipped ticket to WAITING and return a new position', async () => {
      const newCreatedAt = new Date();
      mockPrisma.queueTicket.findFirst.mockResolvedValue({
        id: 'ticket-id',
        serviceId: 'service-id',
      });
      mockPrisma.queueTicket.update.mockResolvedValue({
        id: 'ticket-id',
        ticketNumber: 'A001',
        status: 'WAITING',
        serviceId: 'service-id',
        createdAt: newCreatedAt,
      });
      mockPrisma.dailyQueueCounter.updateMany.mockResolvedValue({ count: 1 });
      mockPrisma.queueTicket.count.mockResolvedValue(9);

      const result = await service.rejoin(ORG_ID, 'ticket-id', staffUser);

      expect(mockPrisma.queueTicket.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: 'WAITING', isRejoin: true }),
        }),
      );
      expect(result.position).toBe(9);
      expect(mockGateway.emitQueueUpdate).toHaveBeenCalledWith(
        ORG_ID,
        expect.objectContaining({ type: 'TICKET_REJOINED' }),
      );
    });

    it('should throw NotFoundException when the ticket is not in SKIPPED status', async () => {
      mockPrisma.queueTicket.findFirst.mockResolvedValue(null);

      await expect(
        service.rejoin(ORG_ID, 'ticket-id', staffUser),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });
});
