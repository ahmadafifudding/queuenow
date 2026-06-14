/**
 * Queue feature barrel (R2 — join + ticket result).
 *
 * Exposes the PURE building blocks (`buildJoinRequest`, `joinQueuePath`,
 * `toJoinedTicketDisplay`) used by the Property 3 / Property 4 tests (tasks 8.2,
 * 8.3), the `useJoinQueue` mutation hook + `isQueueFullError` predicate, the
 * `JoinFlow` screen component delegated to from the thin `app/join/[orgId]`
 * route, and the feature view-model types.
 */
export { buildJoinRequest, joinQueuePath, toJoinedTicketDisplay } from './build-join-request';
export { isQueueFullError, useJoinQueue, type UseJoinQueueDeps } from './use-join-queue';
export {
  buildCancelTicketBody,
  cancelTicketPath,
  isCancelUnavailableError,
  isInvalidTicketStatusError,
  useCancelTicket,
  type CancelTicketBody,
  type UseCancelTicketDeps,
} from './use-cancel-ticket';
export { projectTicketStatus, type ProjectedTicketStatus } from './project-ticket-status';
export { ticketStatusPath, useTicketStatus, type UseTicketStatusDeps } from './use-ticket-status';
export {
  useActiveTicket,
  type UseActiveTicketDeps,
  type UseActiveTicketResult,
} from './use-active-ticket';
export { JoinFlow, type JoinFlowProps } from './components/JoinFlow';
export { TicketTracker, type TicketTrackerProps } from './components/TicketTracker';
export type {
  BuildJoinRequestInput,
  BuildJoinRequestResult,
  JoinedTicket,
  JoinedTicketDisplay,
  JoinQueueVariables,
  JoinRequestIssues,
} from './types';
