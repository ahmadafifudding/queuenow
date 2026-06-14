/*
 * Smoke tests for the boundary test harness itself (task 2.4).
 *
 * These verify the harness doubles behave as documented so the property/example
 * tests that depend on them (2.5, 2.6, 3.3, 3.4, 6.x, 8.x) build on a sound
 * foundation. They are NOT the feature tests — those live with their features.
 */
import { TicketStatus, type IQueueUpdateEvent } from '@queuenow/shared-types';
import { describe, expect, it } from 'vitest';

import { ApiError } from '@/lib/api/client';
import { queryKeys } from '@/lib/api/query-keys';
import { createMockApiClient, createMockSocketClient, createTestQueryClient } from '@/test/harness';

describe('createTestQueryClient', () => {
  it('disables retries on queries and mutations', () => {
    const client = createTestQueryClient();
    const defaults = client.getDefaultOptions();
    expect(defaults.queries?.retry).toBe(false);
    expect(defaults.mutations?.retry).toBe(false);
  });

  it('returns a fresh client each call', () => {
    expect(createTestQueryClient()).not.toBe(createTestQueryClient());
  });
});

describe('createMockApiClient', () => {
  it('resolves a stubbed success envelope with data and meta', async () => {
    const mock = createMockApiClient();
    mock.mockSuccess('GET', '/queue/status', { waiting: 3 }, { total: 1 });

    const result = await mock.client.get<{ waiting: number }>('/queue/status');

    expect(result.data).toEqual({ waiting: 3 });
    expect(result.meta).toEqual({ total: 1 });
  });

  it('rejects with the real ApiError for a stubbed error', async () => {
    const mock = createMockApiClient();
    const error = new ApiError('QUEUE_NO_WAITING', 'No waiting tickets', { serviceId: 'svc' }, 409);
    mock.mockError('POST', '/queue/call-next', error);

    await expect(mock.client.post('/queue/call-next')).rejects.toBe(error);
    await expect(mock.client.post('/queue/call-next')).rejects.toBeInstanceOf(ApiError);
  });

  it('records method, path, and body for assertions', async () => {
    const mock = createMockApiClient();
    mock.mockSuccess('POST', '/services', { id: 's1' });

    await mock.client.post('/services', { name: 'Billing' });

    const calls = mock.getCallsFor('POST', '/services');
    expect(calls).toHaveLength(1);
    expect(calls[0]?.body).toEqual({ name: 'Billing' });
  });

  it('consumes one-shot queued stubs before the sticky fallback', async () => {
    const mock = createMockApiClient();
    mock.mockSuccess('GET', '/x', { v: 'fallback' });
    mock.queueSuccess('GET', '/x', { v: 'first' });

    expect((await mock.client.get<{ v: string }>('/x')).data).toEqual({ v: 'first' });
    expect((await mock.client.get<{ v: string }>('/x')).data).toEqual({ v: 'fallback' });
  });

  it('throws a MOCK_NO_STUB ApiError when nothing is registered', async () => {
    const mock = createMockApiClient();
    await expect(mock.client.get('/unstubbed')).rejects.toMatchObject({ code: 'MOCK_NO_STUB' });
  });
});

describe('createMockSocketClient', () => {
  it('ref-counts room subscriptions and emits only on the boundary transitions', () => {
    const socket = createMockSocketClient();
    socket.connect();
    const room = { orgId: 'org1' };

    socket.subscribeRoom(room);
    socket.subscribeRoom(room); // second subscriber: no new emit
    expect(socket.getSubscribedRooms()).toHaveLength(1);

    socket.unsubscribeRoom(room); // still one subscriber left
    expect(socket.getSubscribedRooms()).toHaveLength(1);
    socket.unsubscribeRoom(room); // last subscriber: release

    expect(socket.getSubscribedRooms()).toHaveLength(0);
    const events = socket.getSentMessages().map((m) => m.event);
    expect(events).toEqual(['subscribe', 'unsubscribe']);
  });

  it('re-subscribes every tracked room on reconnect', () => {
    const socket = createMockSocketClient();
    socket.connect();
    socket.subscribeRoom({ orgId: 'org1' });
    socket.disconnect();
    socket.connect();

    const subscribeCount = socket.getSentMessages().filter((m) => m.event === 'subscribe').length;
    expect(subscribeCount).toBe(2); // initial + on reconnect
  });

  it('bridges queue:update events to invalidate the matching query key', () => {
    const socket = createMockSocketClient();
    const queryClient = createTestQueryClient();
    const orgId = 'org1';
    const serviceId = 'svc1';
    socket.bridgeTo(queryClient);
    socket.connect();
    socket.subscribeRoom({ orgId, serviceId });

    let invalidated: unknown;
    const original = queryClient.invalidateQueries.bind(queryClient);
    queryClient.invalidateQueries = ((filters?: { queryKey?: unknown }) => {
      invalidated = filters?.queryKey;
      return original(filters as never);
    }) as typeof queryClient.invalidateQueries;

    const event: IQueueUpdateEvent = {
      type: 'TICKET_CALLED',
      ticket: { id: 't1', ticketNumber: 'A001', status: TicketStatus.CALLED, serviceId },
    };
    socket.emitQueueUpdate(event);

    expect(invalidated).toEqual(queryKeys.queue(orgId, serviceId));
  });

  it('drives connection-state transitions', () => {
    const socket = createMockSocketClient();
    expect(socket.getStatus()).toBe('idle');
    socket.connect();
    expect(socket.getStatus()).toBe('connected');
    socket.reconnecting();
    expect(socket.getStatus()).toBe('reconnecting');
    socket.disconnect();
    expect(socket.getStatus()).toBe('disconnected');
  });
});
