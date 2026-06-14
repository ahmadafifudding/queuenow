/**
 * Test QueryClient factory (boundary harness — task 2.4).
 *
 * Produces a fresh, fully-isolated `QueryClient` with retries DISABLED and no
 * stale window, so query/invalidation behavior (e.g. the `ticket:update` bridge,
 * Property 6) is deterministic and fast: a failure surfaces immediately instead
 * of being retried, and no background refetch timers fire during a test.
 *
 * Each call returns a NEW client so suites never share cache state. This is
 * deliberately independent of the production singleton in `lib/api/query-client`
 * (which carries retry/staleness tuned for the running app).
 */
import { QueryClient } from '@tanstack/react-query';

/** Build a fresh QueryClient suitable for tests (no retries, no stale timers). */
export function createTestQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        staleTime: 0,
        gcTime: Infinity,
        refetchOnWindowFocus: false,
        refetchOnReconnect: false,
      },
      mutations: {
        retry: false,
      },
    },
  });
}
