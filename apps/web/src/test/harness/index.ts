/*
 * Boundary test harness (task 2.4, Requirement 15.1).
 *
 * Reusable doubles that let every web test mock the API_Client and Socket_Client
 * at the boundary and wrap components in a deterministic QueryClient — no real
 * backend, no real socket. Consumed by tasks 2.5, 2.6, 3.3, 3.4, 6.x and 8.x.
 */
export {
  createMockApiClient,
  type ApiClientSurface,
  type HttpMethod,
  type MockApiClient,
  type RecordedCall,
  type StubHandler,
  type StubOutcome,
} from './mock-api-client';

export {
  createMockSocketClient,
  type EventHandler,
  type MockSocketClient,
  type SentMessage,
} from './mock-socket-client';

export { createTestQueryClient } from './query-client';
