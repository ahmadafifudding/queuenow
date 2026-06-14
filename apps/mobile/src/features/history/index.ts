/**
 * Ticket history feature barrel (R7).
 *
 * Exposes the PURE projection helpers (`sortHistoryDescending`, `toHistoryRow`,
 * `projectTicketHistory`) used by the Property 12 / Property 13 tests (tasks
 * 12.2, 12.3), the `useTicketHistory` query hook (task 12.4), the `HistoryScreen`
 * delegated to from the thin `app/(account)/history` route, and the feature
 * view-model types.
 */
export { projectTicketHistory, sortHistoryDescending, toHistoryRow } from './history-projection';
export {
  TICKET_HISTORY_PATH,
  useTicketHistory,
  type UseTicketHistoryDeps,
} from './use-ticket-history';
export { HistoryScreen } from './components/HistoryScreen';
export type { HistoryRow, TicketHistoryEntry } from './types';
