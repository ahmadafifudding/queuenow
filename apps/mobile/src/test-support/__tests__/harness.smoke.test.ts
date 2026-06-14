/**
 * Boundary harness smoke test (task 2.4).
 *
 * Confirms the test runner is wired up: `fast-check` runs property checks and
 * every harness fake constructs and behaves. It deliberately exercises the
 * fakes' OWN behavior only — the real property tests (Properties 1–21) live in
 * their own tasks and bind these fakes to the production pure modules.
 */
import fc from 'fast-check';
import { NotificationType } from '@queuenow/shared-types';
import { describe, expect, it } from 'vitest';

import {
  createFakeAppStateSource,
  createFakeNetInfoSource,
  createFakeNotificationPorts,
  createFakeSocket,
  createInMemoryAsyncStorage,
  createInMemorySecureStore,
  createMockTokenStore,
  createSequencedFetch,
  createTestQueryClient,
  errorEnvelope,
  successEnvelope,
} from '..';

describe('boundary harness (task 2.4)', () => {
  it('runs fast-check property checks', () => {
    fc.assert(
      fc.property(fc.integer(), fc.integer(), (a, b) => a + b === b + a),
      { numRuns: 100 },
    );
  });

  it('builds success and error envelopes matching the backend contract', () => {
    fc.assert(
      fc.property(fc.string(), (code) => {
        const ok = successEnvelope({ value: 1 }, { total: 1 });
        const err = errorEnvelope(code, 'msg');
        return (
          ok.success === true &&
          ok.data.value === 1 &&
          ok.meta?.total === 1 &&
          err.success === false &&
          err.error.code === code
        );
      }),
      { numRuns: 100 },
    );
  });

  it('drives a recording fake fetch through a scripted response', async () => {
    const { fetch, calls } = createSequencedFetch([
      new Response(JSON.stringify(successEnvelope({ ok: true })), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    ]);

    const response = await fetch('https://api.test/health', { method: 'GET' });
    const body = (await response.json()) as { success: boolean; data: { ok: boolean } };

    expect(response.status).toBe(200);
    expect(body.data.ok).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe('https://api.test/health');
    expect(calls[0]?.method).toBe('GET');
  });

  it('round-trips and clears the in-memory secure store with failure injection', async () => {
    const store = createInMemorySecureStore();
    await store.setItemAsync('accessToken', 'abc');
    expect(await store.getItemAsync('accessToken')).toBe('abc');
    expect(store.has('accessToken')).toBe(true);

    store.setFailRead(true);
    await expect(store.getItemAsync('accessToken')).rejects.toThrow();

    store.setFailRead(false);
    await store.deleteItemAsync('accessToken');
    expect(store.has('accessToken')).toBe(false);
  });

  it('round-trips the in-memory async storage', async () => {
    const storage = createInMemoryAsyncStorage();
    await storage.setItem('store:activeTicket', '{"x":1}');
    expect(await storage.getItem('store:activeTicket')).toBe('{"x":1}');
    await storage.removeItem('store:activeTicket');
    expect(await storage.getItem('store:activeTicket')).toBeNull();
  });

  it('exposes a token store with injectable read failure', async () => {
    const tokens = createMockTokenStore({ accessToken: 'a', refreshToken: 'r' });
    expect(await tokens.getAccessToken()).toBe('a');

    await tokens.setTokens({ accessToken: 'a2', refreshToken: 'r2' });
    expect(tokens.current.accessToken).toBe('a2');

    tokens.setFailGetAccessToken(true);
    await expect(tokens.getAccessToken()).rejects.toThrow();

    await tokens.clearTokens();
    expect(tokens.current.refreshToken).toBeNull();
  });

  it('records outgoing emits and dispatches server + manager events on the fake socket', () => {
    const socket = createFakeSocket();

    let connectCount = 0;
    let lastUpdate: unknown = null;
    let reconnectAttempts = 0;
    socket.on('connect', () => {
      connectCount += 1;
    });
    socket.on('ticket:update', (payload) => {
      lastUpdate = payload;
    });
    socket.io.on('reconnect_attempt', () => {
      reconnectAttempts += 1;
    });

    socket.connect();
    socket.emit('subscribe:ticket', { ticketId: 't1' });
    socket.serverEmit('ticket:update', { ticket: { id: 't1' } });
    socket.emitManager('reconnect_attempt');

    expect(socket.connected).toBe(true);
    expect(connectCount).toBe(1);
    expect(socket.emitsFor('subscribe:ticket')).toHaveLength(1);
    expect(lastUpdate).toEqual({ ticket: { id: 't1' } });
    expect(reconnectAttempts).toBe(1);
  });

  it('drives connectivity sources to subscribed listeners', async () => {
    const netInfo = createFakeNetInfoSource();
    const appState = createFakeAppStateSource('active');

    const seen: Array<boolean | null> = [];
    const unsubscribe = netInfo.source.addEventListener((s) => seen.push(s.isConnected));
    netInfo.setOnline(false);
    expect((await netInfo.source.fetch()).isConnected).toBe(false);
    unsubscribe();

    const states: string[] = [];
    const sub = appState.source.addEventListener((s) => states.push(s));
    appState.emit('background');
    sub.remove();

    expect(seen).toContain(false);
    expect(appState.source.currentState).toBe('background');
    expect(states).toEqual(['background']);
  });

  it('records notification port interactions', async () => {
    const ports = createFakeNotificationPorts({ permissionGranted: false, foreground: true });
    expect(await ports.permissions.isGranted()).toBe(false);
    expect(ports.appState.isForeground()).toBe(true);

    ports.banner.show({ type: NotificationType.YOUR_TURN, title: 'Hi', body: 'Body' });
    await ports.audible.play();

    expect(ports.banners).toHaveLength(1);
    expect(ports.playedCount()).toBe(1);
    expect(ports.toDeps().permissions).toBe(ports.permissions);
  });

  it('builds a fresh QueryClient with retries disabled', () => {
    const client = createTestQueryClient();
    expect(client.getDefaultOptions().queries?.retry).toBe(false);
    client.clear();
  });
});
