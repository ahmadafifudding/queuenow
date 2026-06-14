/**
 * Boundary test harness (task 2.4) — single entry point.
 *
 * Re-exports the reusable fakes/builders the property and integration tests
 * (tasks 2.5–2.8, 3.x, 4.x, 5.3, 6.x, 7.x, 8.x, 9.x, 12.x, 13.2, 14.2, 20.3)
 * depend on. Every fake implements a production dependency-injection seam so no
 * test touches a real backend, device keychain, AsyncStorage, live socket, or
 * native notification module:
 *
 *  - REST:          `fake-rest`         — envelope builders, recording fake
 *                                         `fetch`, and an in-memory `TokenStore`
 *                                         (the `createApiClient` seams).
 *  - Secure store:  `fake-secure-store` — in-memory `SecureStoreAdapter` with
 *                                         injectable read/write failures.
 *  - Async storage: `fake-async-storage`— in-memory `AsyncStorageAdapter` for
 *                                         the offline active-ticket cache.
 *  - Socket:        `fake-socket`       — controllable `Socket` double that
 *                                         drives `ticket:update`/
 *                                         `ticket:notification` + connection state.
 *  - Connectivity:  `fake-connectivity` — controllable `NetInfoSource` /
 *                                         `AppStateSource`.
 *  - Notifications: `fake-notifications`— fake permission/app-state/presenter/
 *                                         audible/banner ports.
 *  - Query:         `query-client`      — a retries-disabled `QueryClient` factory.
 */
export * from './fake-rest';
export * from './fake-secure-store';
export * from './fake-async-storage';
export * from './fake-socket';
export * from './fake-connectivity';
export * from './fake-notifications';
export * from './query-client';
