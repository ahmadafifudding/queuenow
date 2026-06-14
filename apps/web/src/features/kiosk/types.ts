/*
 * App-local types for the public Kiosk ticket-taking flow (R12).
 *
 * These mirror the shapes returned by the backend's PUBLIC endpoints (see
 * `api/endpoints.ts` for the exact paths and the assumptions behind them). The
 * Kiosk keeps its own copy rather than importing another feature's internals
 * (per the frontend-web feature-isolation rule); the only cross-feature sharing
 * is via `lib/` and `components/`.
 */

/**
 * An active service a customer can take a ticket for (R12.2).
 *
 * Derived from the public queue-status endpoint, which only returns ACTIVE
 * services — so every entry here is selectable.
 */
export interface KioskService {
  /** Service id (a UUID); used as `serviceId` in the join payload. */
  id: string;
  /** Human-facing service name shown on the selection tiles. */
  name: string;
  /** Short ticket prefix (e.g. `A`), used as a compact visual hint. */
  prefix: string;
}

/**
 * The per-organization queue settings that drive required-field gating (R12.3).
 *
 * Mirrors the backend `QueueSettings` (`requireName`, `requirePhone`,
 * `maxRecall`, …). The Kiosk only needs the two `require*` booleans; other
 * fields are accepted but ignored so the type stays forward-compatible.
 */
export interface KioskQueueSettings {
  /** When true, the customer name is required to join (R12.3). */
  requireName: boolean;
  /** When true, the customer phone is required to join (R12.3). */
  requirePhone: boolean;
  /** Max recall count (unused by the Kiosk, kept for shape compatibility). */
  maxRecall?: number;
}

/**
 * The ticket assigned after a successful join (R12.4).
 *
 * The backend returns the full ticket aggregate; the Kiosk only reads the
 * fields it renders. `id` is the tracking key embedded in the QR code (R12.5).
 */
export interface KioskJoinedTicket {
  /** Ticket id — the stable key used to build the tracking URL/QR (R12.5). */
  id: string;
  /** Human-facing ticket number to display prominently (e.g. `A012`) (R12.4). */
  ticketNumber: string;
  /** Position in the waiting line at issue time, when provided. */
  position?: number | null;
  /** Estimated wait in minutes at issue time, when provided. */
  estimatedWaitMinutes?: number | null;
}
