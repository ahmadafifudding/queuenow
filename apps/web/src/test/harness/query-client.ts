/*
 * Test QueryClient factory (task 2.4, Requirement 15.1).
 *
 * Returns a fresh `QueryClient` configured for deterministic tests:
 * - `retry: false` on both queries and mutations so a thrown `ApiError` surfaces
 *   immediately instead of being retried (the production client at
 *   `lib/api/query-client.ts` retries server errors — tests must not).
 * - `gcTime: Infinity` + `staleTime: Infinity` so cached data never expires or is
 *   garbage-collected mid-test, removing timing-based flakiness.
 * - Refetch-on-* disabled so a query only runs when a test explicitly triggers
 *   it (mount / invalidation), never from focus/reconnect side effects.
 *
 * Each call returns a brand-new client so tests are fully isolated; never share
 * one client across tests.
 */
import { QueryClient } from '@tanstack/react-query';

/**
 * Create a fresh {@link QueryClient} with retries disabled and caching pinned to
 * deterministic values for tests.
 *
 * @returns a new, isolated `QueryClient` suitable for wrapping a component under
 * test or for driving the socket-to-query bridge.
 */
export function createTestQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        gcTime: Number.POSITIVE_INFINITY,
        staleTime: Number.POSITIVE_INFINITY,
        refetchOnWindowFocus: false,
        refetchOnReconnect: false,
        refetchOnMount: false,
      },
      mutations: {
        retry: false,
      },
    },
  });
}
