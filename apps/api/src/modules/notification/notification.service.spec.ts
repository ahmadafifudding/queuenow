import { NotificationType } from '@queuenow/shared-types';

import type { ConfigService } from '@nestjs/config';
import type { PrismaService } from '../../prisma/prisma.service';
import { NotificationService } from './notification.service';

/**
 * Unit tests for Expo push delivery in `NotificationService.sendNotification`
 * (task 18.1, tested in 18.2).
 * Validates: Requirements 13.2
 *
 * These exercise the real delivery decision path (`sendNotification` →
 * `deliverPush` → `markStatus`) with a mocked Prisma + ConfigService and a
 * stubbed Expo client, so no network calls occur. The exact status semantics
 * asserted here mirror the 18.1 implementation:
 *   - the record is always created PENDING;
 *   - enabled + valid token + ok ticket ⇒ SENT;
 *   - enabled + error ticket / thrown error ⇒ FAILED (no throw);
 *   - enabled + invalid (non-Expo) token ⇒ FAILED without dispatch;
 *   - no registered token ⇒ left PENDING, no dispatch, no throw;
 *   - disabled delivery ⇒ SENT without dispatch (prior status preserved).
 */

// --- expo-server-sdk stub -------------------------------------------------
// jest.mock is hoisted; only `mock`-prefixed identifiers may be referenced
// inside the factory.
const mockSendPushNotificationsAsync = jest.fn();
const mockIsExpoPushToken = jest.fn();
const mockExpoConstructor = jest.fn();

jest.mock('expo-server-sdk', () => ({
  Expo: Object.assign(
    jest.fn().mockImplementation((...args: unknown[]) => {
      mockExpoConstructor(...args);
      return { sendPushNotificationsAsync: mockSendPushNotificationsAsync };
    }),
    { isExpoPushToken: (token: unknown) => mockIsExpoPushToken(token) as boolean },
  ),
}));

const TICKET_ID = 'ticket-1';
const CUSTOMER_ID = 'customer-1';
const ORG_ID = 'org-1';
const NOTIFICATION_ID = 'notif-1';
const VALID_EXPO_TOKEN = 'ExponentPushToken[xxxxxxxxxxxxxxxxxxxxxx]';
const INVALID_TOKEN = 'not-an-expo-token';

const ALL_TURN_TYPES: NotificationType[] = [
  NotificationType.YOUR_TURN,
  NotificationType.ALMOST_TURN,
  NotificationType.SKIPPED,
];

interface BuildOptions {
  /** Value returned for the `EXPO_PUSH_ENABLED` config key. */
  pushEnabled: boolean;
  /** The customer's stored push token (`null` ⇒ no registered token). */
  customerPushToken: string | null;
}

interface Harness {
  service: NotificationService;
  create: jest.Mock;
  update: jest.Mock;
  findUnique: jest.Mock;
  ticketFindUnique: jest.Mock;
}

function buildService({ pushEnabled, customerPushToken }: BuildOptions): Harness {
  const create = jest.fn().mockResolvedValue({
    id: NOTIFICATION_ID,
    ticketId: TICKET_ID,
    customerId: CUSTOMER_ID,
    status: 'PENDING',
  });
  const update = jest.fn().mockResolvedValue({ id: NOTIFICATION_ID });
  const findUnique = jest
    .fn()
    .mockResolvedValue(
      customerPushToken === null ? { pushToken: null } : { pushToken: customerPushToken },
    );
  // The ticket lookup supplies the orgId threaded into the push `data` payload (R13.3).
  const ticketFindUnique = jest.fn().mockResolvedValue({ orgId: ORG_ID });

  const prisma = {
    notification: { create, update },
    customerProfile: { findUnique },
    queueTicket: { findUnique: ticketFindUnique },
  } as unknown as PrismaService;

  const configService = {
    get: jest.fn((key: string, defaultValue?: unknown) => {
      if (key === 'EXPO_PUSH_ENABLED') return pushEnabled;
      if (key === 'EXPO_ACCESS_TOKEN') return undefined;
      return defaultValue;
    }),
  } as unknown as ConfigService;

  const service = new NotificationService(prisma, configService);
  return { service, create, update, findUnique, ticketFindUnique };
}

beforeEach(() => {
  mockSendPushNotificationsAsync.mockReset();
  mockIsExpoPushToken.mockReset();
  mockExpoConstructor.mockReset();
});

describe('NotificationService.sendNotification push delivery (R13.2)', () => {
  it('always creates the notification record with PENDING status', async () => {
    // No token: delivery is skipped, but the record must still be created PENDING.
    const { service, create } = buildService({
      pushEnabled: true,
      customerPushToken: null,
    });

    await service.sendNotification(TICKET_ID, CUSTOMER_ID, NotificationType.YOUR_TURN);

    expect(create).toHaveBeenCalledTimes(1);
    expect(create).toHaveBeenCalledWith({
      data: {
        ticketId: TICKET_ID,
        customerId: CUSTOMER_ID,
        type: NotificationType.YOUR_TURN,
        status: 'PENDING',
      },
    });
  });

  it.each(ALL_TURN_TYPES)(
    'dispatches once via Expo and marks SENT for a valid token (type=%s)',
    async (type) => {
      const { service, update } = buildService({
        pushEnabled: true,
        customerPushToken: VALID_EXPO_TOKEN,
      });
      mockIsExpoPushToken.mockReturnValue(true);
      mockSendPushNotificationsAsync.mockResolvedValue([{ status: 'ok', id: 'receipt-1' }]);

      await service.sendNotification(TICKET_ID, CUSTOMER_ID, type);

      expect(mockSendPushNotificationsAsync).toHaveBeenCalledTimes(1);
      const [messages] = mockSendPushNotificationsAsync.mock.calls[0] as [
        Array<{ to: string; data: { ticketId: string; orgId: string; type: string } }>,
      ];
      expect(messages).toHaveLength(1);
      expect(messages[0]).toMatchObject({
        to: VALID_EXPO_TOKEN,
        data: { ticketId: TICKET_ID, orgId: ORG_ID, type },
      });

      expect(update).toHaveBeenCalledTimes(1);
      expect(update).toHaveBeenCalledWith({
        where: { id: NOTIFICATION_ID },
        data: { status: 'SENT', sentAt: expect.any(Date) },
      });
    },
  );

  it('marks FAILED without throwing when the provider returns an error ticket', async () => {
    const { service, update } = buildService({
      pushEnabled: true,
      customerPushToken: VALID_EXPO_TOKEN,
    });
    mockIsExpoPushToken.mockReturnValue(true);
    mockSendPushNotificationsAsync.mockResolvedValue([
      { status: 'error', message: 'DeviceNotRegistered' },
    ]);

    await expect(
      service.sendNotification(TICKET_ID, CUSTOMER_ID, NotificationType.YOUR_TURN),
    ).resolves.toBeDefined();

    expect(mockSendPushNotificationsAsync).toHaveBeenCalledTimes(1);
    expect(update).toHaveBeenCalledWith({
      where: { id: NOTIFICATION_ID },
      data: { status: 'FAILED', sentAt: null },
    });
  });

  it('marks FAILED without throwing when the provider call throws (graceful degradation)', async () => {
    const { service, update } = buildService({
      pushEnabled: true,
      customerPushToken: VALID_EXPO_TOKEN,
    });
    mockIsExpoPushToken.mockReturnValue(true);
    mockSendPushNotificationsAsync.mockRejectedValue(new Error('network down'));

    await expect(
      service.sendNotification(TICKET_ID, CUSTOMER_ID, NotificationType.ALMOST_TURN),
    ).resolves.toBeDefined();

    expect(mockSendPushNotificationsAsync).toHaveBeenCalledTimes(1);
    expect(update).toHaveBeenCalledWith({
      where: { id: NOTIFICATION_ID },
      data: { status: 'FAILED', sentAt: null },
    });
  });

  it('marks FAILED without dispatch for an invalid (non-Expo) token', async () => {
    const { service, update } = buildService({
      pushEnabled: true,
      customerPushToken: INVALID_TOKEN,
    });
    mockIsExpoPushToken.mockReturnValue(false);

    await service.sendNotification(TICKET_ID, CUSTOMER_ID, NotificationType.SKIPPED);

    expect(mockSendPushNotificationsAsync).not.toHaveBeenCalled();
    expect(update).toHaveBeenCalledWith({
      where: { id: NOTIFICATION_ID },
      data: { status: 'FAILED', sentAt: null },
    });
  });

  it('attempts no delivery and leaves the record PENDING when no token is registered', async () => {
    const { service, update } = buildService({
      pushEnabled: true,
      customerPushToken: null,
    });

    await expect(
      service.sendNotification(TICKET_ID, CUSTOMER_ID, NotificationType.YOUR_TURN),
    ).resolves.toBeDefined();

    // No dispatch and no status transition: the PENDING record stands.
    expect(mockSendPushNotificationsAsync).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
  });

  it('records SENT without dispatch when delivery is disabled (EXPO_PUSH_ENABLED false)', async () => {
    const { service, update } = buildService({
      pushEnabled: false,
      customerPushToken: VALID_EXPO_TOKEN,
    });

    await service.sendNotification(TICKET_ID, CUSTOMER_ID, NotificationType.YOUR_TURN);

    // Disabled path: Expo is never constructed and never invoked, but the prior
    // status semantics (token-bearing notification ⇒ SENT) are preserved.
    expect(mockExpoConstructor).not.toHaveBeenCalled();
    expect(mockSendPushNotificationsAsync).not.toHaveBeenCalled();
    expect(update).toHaveBeenCalledWith({
      where: { id: NOTIFICATION_ID },
      data: { status: 'SENT', sentAt: expect.any(Date) },
    });
  });
});
