/**
 * Ticket-history query hook (R7.1, R7.3, R7.4).
 *
 * {@link useTicketHistory} reads the signed-in customer's history through the
 * single shared `apiClient` + TanStack Query on the central `queryKeys.history`
 * key. It is ENABLED ONLY WHEN SIGNED IN (R7.4): when signed out the query never
 * runs, and combined with the sign-out cache removal (task 2.2) no account data
 * — including history cached from a previous session — is fetched or retained.
 *
 * The request is marked `authenticated` so the REST client attaches the Bearer
 * token (or fails closed). The response is handed to the PURE
 * {@link projectTicketHistory} so rows are ordered most-recent-first (R7.3) and
 * projected to the required display fields (R7.2) — keeping ordering/projection
 * logic testable in isolation (Properties 12/13).
 */
import { useQuery, type UseQueryResult } from '@tanstack/react-query';

import { apiClient as defaultApiClient, type ApiClient } from '@/lib/api/client';
import { queryKeys } from '@/lib/api/query-keys';
import { useAuthStore } from '@/lib/auth/auth-store';

import { projectTicketHistory } from './history-projection';
import type { HistoryRow, TicketHistoryEntry } from './types';

/** The history endpoint path (Bearer-auth; design endpoint map, R7.1). */
export const TICKET_HISTORY_PATH = '/customers/history';

/** Injectable boundaries for {@link useTicketHistory}; optional with real defaults. */
export interface UseTicketHistoryDeps {
  /** REST client used to GET the history. Defaults to the shared {@link apiClient}. */
  apiClient?: ApiClient;
}

/**
 * Fetch the signed-in customer's ticket history as display-ready rows.
 *
 * The query is disabled while signed out (R7.4); when signed in it issues an
 * authenticated `GET /customers/history` (R7.1) and returns rows ordered
 * most-recent-first (R7.3).
 *
 * @param deps Optional injected boundaries (for tests).
 * @returns The TanStack Query result; `data` is the projected history rows.
 */
export function useTicketHistory(deps: UseTicketHistoryDeps = {}): UseQueryResult<HistoryRow[]> {
  const api = deps.apiClient ?? defaultApiClient;
  const isSignedIn = useAuthStore((state) => state.status === 'signed-in');

  return useQuery({
    queryKey: queryKeys.history(),
    // R7.4 — never fetch (or retain) account history while signed out.
    enabled: isSignedIn,
    queryFn: async (): Promise<HistoryRow[]> => {
      const { data } = await api.get<TicketHistoryEntry[]>(TICKET_HISTORY_PATH, {
        authenticated: true,
      });
      return projectTicketHistory(data);
    },
  });
}
