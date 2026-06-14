/**
 * Queue feature types (R2 — join + ticket result).
 *
 * These compose the shared domain types from `@queuenow/shared-types`
 * (`IQueueTicket`) and the shared validation input (`JoinQueueInput`); the app
 * NEVER redefines shared domain types (R10.5, R14.5). `JoinedTicket` is the
 * client-side view model the design names: the `IQueueTicket` returned by
 * `POST /organizations/:orgId/queue/join` augmented with the backend-computed
 * `position` and `estimatedWaitMinutes` (displayed verbatim, R2.4).
 */
import type { IQueueTicket } from '@queuenow/shared-types';
import type { JoinQueueInput } from '@queuenow/shared-validation';

/**
 * The join response augments {@link IQueueTicket} with the backend-computed
 * `position` and `estimatedWaitMinutes` (the same shape `QueueService.joinQueue`
 * returns). Both are displayed verbatim — the app applies NO client-side offset
 * (R2.4).
 */
export interface JoinedTicket extends IQueueTicket {
  /** Position in line as computed by the backend; shown verbatim (R2.4). */
  position: number;
  /** Estimated wait in minutes as computed by the backend; shown verbatim (R2.4). */
  estimatedWaitMinutes: number;
  /** The joined service, included by the backend `include` on join. */
  service?: { id: string; name: string; prefix: string; avgServingTime: number };
}

/**
 * Input to the PURE {@link buildJoinRequest} helper. Combines the join target
 * (`orgId`/`serviceId`), the stable anonymous `deviceFingerprint` (R2.3), the
 * optional customer-provided contact details (R2.6), and the current session
 * state used to attach `customerProfileId` only when signed in (R2.6).
 */
export interface BuildJoinRequestInput {
  /** The organization id the join is scoped to. */
  orgId: string;
  /** The selected service's id (must be a uuid per the shared schema). */
  serviceId: string;
  /** The stable anonymous device fingerprint; MUST be non-empty (R2.3). */
  deviceFingerprint: string;
  /** Optional customer name; included only when provided (R2.2). */
  customerName?: string;
  /** Optional customer phone; included only when provided (R2.2). */
  customerPhone?: string;
  /** Whether a customer account session is active (R2.6). */
  isSignedIn: boolean;
  /** The signed-in customer's profile id; included only when signed in (R2.6). */
  customerProfileId?: string | null;
}

/** Flattened validation issues from the shared `joinQueueSchema`. */
export interface JoinRequestIssues {
  formErrors: string[];
  fieldErrors: Partial<Record<keyof JoinQueueInput, string[]>>;
}

/**
 * The result of {@link buildJoinRequest}. Either a `valid` request (the target
 * `path` plus the schema-validated `body`, safe to send) or an `invalid`
 * outcome carrying the `issues` — invalid input NEVER reaches the network
 * (R2.7).
 */
export type BuildJoinRequestResult =
  | { valid: true; path: string; body: JoinQueueInput }
  | { valid: false; issues: JoinRequestIssues };

/**
 * The verbatim ticket-result projection shown after a successful join (R2.4).
 * Produced by the pure {@link toJoinedTicketDisplay} selector so the display
 * values can be asserted equal to the backend values with no client arithmetic.
 */
export interface JoinedTicketDisplay {
  /** The issued ticket number (e.g. `A001`). */
  ticketNumber: string;
  /** Backend `position`, passed through unchanged (R2.4). */
  position: number;
  /** Backend `estimatedWaitMinutes`, passed through unchanged (R2.4). */
  estimatedWaitMinutes: number;
}

/** Variables accepted by the join mutation (the form's optional contact fields). */
export interface JoinQueueVariables {
  /** The selected service id. */
  serviceId: string;
  /** Optional customer name (R2.2). */
  customerName?: string;
  /** Optional customer phone (R2.2). */
  customerPhone?: string;
}
