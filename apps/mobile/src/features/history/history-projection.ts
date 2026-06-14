/**
 * Pure ticket-history projection helpers (R7.2, R7.3).
 *
 * These are side-effect-free so the property tests (tasks 12.2 / 12.3) can
 * exercise them directly:
 *  - {@link sortHistoryDescending} guarantees a non-increasing `createdAt`
 *    display order (Property 12). The backend already returns history newest-
 *    first, but the app sorts defensively so the displayed order is correct
 *    regardless of source ordering.
 *  - {@link toHistoryRow} projects an entry to the exact required row fields
 *    (Property 13): organization name, service name, `ticketNumber`, status.
 *  - {@link projectTicketHistory} composes the two: sort, then project — the
 *    single transform the query hook applies before handing rows to the screen.
 */
import type { HistoryRow, TicketHistoryEntry } from './types';

/** Parse an ISO-8601 timestamp to epoch millis; unparseable values sort last. */
function toEpoch(createdAt: string): number {
  const ms = Date.parse(createdAt);
  return Number.isNaN(ms) ? Number.NEGATIVE_INFINITY : ms;
}

/**
 * Return a new array of entries ordered most-recent-first by `createdAt` (R7.3).
 *
 * The sort is non-mutating (operates on a copy) and stable enough for display:
 * entries with equal timestamps retain their input order. Entries with an
 * unparseable `createdAt` sort to the end.
 *
 * @param entries The history entries to order.
 * @returns A new, descending-by-`createdAt` array.
 */
export function sortHistoryDescending<T extends { createdAt: string }>(entries: readonly T[]): T[] {
  return [...entries].sort((a, b) => toEpoch(b.createdAt) - toEpoch(a.createdAt));
}

/**
 * Project a {@link TicketHistoryEntry} to its display-ready {@link HistoryRow},
 * exposing exactly the required fields (R7.2): organization name, service name,
 * `ticketNumber`, and the ticket status.
 *
 * @param entry The raw history entry from `GET /customers/history`.
 * @returns The flattened row for rendering.
 */
export function toHistoryRow(entry: TicketHistoryEntry): HistoryRow {
  return {
    id: entry.id,
    organizationName: entry.organization.name,
    serviceName: entry.service.name,
    ticketNumber: entry.ticketNumber,
    status: entry.status,
    createdAt: entry.createdAt,
  };
}

/**
 * The single transform the history hook applies: order entries most-recent-first
 * (R7.3) and project each to its required display fields (R7.2).
 *
 * @param entries The raw history entries from the backend.
 * @returns Display-ready rows in reverse-chronological order.
 */
export function projectTicketHistory(entries: readonly TicketHistoryEntry[]): HistoryRow[] {
  return sortHistoryDescending(entries).map(toHistoryRow);
}
