/*
 * Pure optimistic-patch helpers for the serving mutation hooks (R6.10).
 *
 * The staff queue panel reads an AGGREGATE snapshot (`QueueStatusResponse` from
 * task 8.1): per-service counts plus a small `currentlyCalled` summary list. A
 * serving action therefore patches those aggregate fields rather than a list of
 * individual tickets. Each helper is a pure, immutable transform of the cached
 * snapshot so the `onMutate` patch and the rollback snapshot stay trivially
 * correct and independently testable (design Property 10, task 8.3).
 *
 * All helpers locate the affected service by the ticket/counter `serviceId` and
 * leave every other service untouched. Counts are clamped at zero so an
 * out-of-order optimistic patch can never produce a negative count before the
 * authoritative refetch (success invalidation + socket reconciliation, R6.12).
 *
 * NOTE (recall): the aggregate snapshot does not surface a per-ticket recall
 * count (`CalledTicketSummary` carries only `ticketNumber` + `counterName`), so
 * "recall" has no aggregate-visible optimistic patch — its updated recall count
 * (R6.5) is reflected by the post-success invalidation / socket reconcile. The
 * recall hook still snapshots and rolls back like the others for safety.
 */
import type { QueueServiceStatus, QueueStatusResponse } from '../types';

/** Identifies which service card within the aggregate a patch applies to. */
export interface ServiceScopedVars {
  /** The service the affected ticket/counter belongs to. */
  serviceId: string;
}

/** A patch that also needs the ticket number to drop it from `currentlyCalled`. */
export interface CalledTicketVars extends ServiceScopedVars {
  /** Human-facing ticket number used to match the entry in `currentlyCalled`. */
  ticketNumber: string;
}

/**
 * Apply `fn` to the single service whose id matches `serviceId`, returning a new
 * `QueueStatusResponse`. Services that do not match are returned unchanged.
 */
export function patchServiceById(
  status: QueueStatusResponse,
  serviceId: string,
  fn: (service: QueueServiceStatus) => QueueServiceStatus,
): QueueStatusResponse {
  return {
    ...status,
    services: status.services.map((service) =>
      service.service.id === serviceId ? fn(service) : service,
    ),
  };
}

/** Call-next pulls one ticket out of WAITING → CALLED: decrement `waiting`. */
export function applyCallNextPatch(
  status: QueueStatusResponse,
  vars: ServiceScopedVars,
): QueueStatusResponse {
  return patchServiceById(status, vars.serviceId, (service) => ({
    ...service,
    waiting: Math.max(0, service.waiting - 1),
  }));
}

/** Skip removes a CALLED ticket from the active serving list (R6.7). */
export function applySkipPatch(
  status: QueueStatusResponse,
  vars: CalledTicketVars,
): QueueStatusResponse {
  return patchServiceById(status, vars.serviceId, (service) => ({
    ...service,
    currentlyCalled: service.currentlyCalled.filter(
      (ticket) => ticket.ticketNumber !== vars.ticketNumber,
    ),
  }));
}

/** Complete marks a CALLED/SERVING ticket COMPLETED (R6.8): drop it, bump done. */
export function applyCompletePatch(
  status: QueueStatusResponse,
  vars: CalledTicketVars,
): QueueStatusResponse {
  return patchServiceById(status, vars.serviceId, (service) => ({
    ...service,
    currentlyCalled: service.currentlyCalled.filter(
      (ticket) => ticket.ticketNumber !== vars.ticketNumber,
    ),
    serving: Math.max(0, service.serving - 1),
    completedToday: service.completedToday + 1,
  }));
}

/** Rejoin returns a SKIPPED ticket to WAITING (R6.9): increment `waiting`. */
export function applyRejoinPatch(
  status: QueueStatusResponse,
  vars: ServiceScopedVars,
): QueueStatusResponse {
  return patchServiceById(status, vars.serviceId, (service) => ({
    ...service,
    waiting: service.waiting + 1,
  }));
}
