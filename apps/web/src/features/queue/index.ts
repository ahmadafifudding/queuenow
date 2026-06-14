/*
 * Public surface of the queue feature. Routes and other features import from
 * here rather than reaching into internals.
 */
export { QueueStatusView } from './components/QueueStatusView';
export type { QueueStatusViewProps } from './components/QueueStatusView';
export { CounterSelector } from './components/CounterSelector';
export type { CounterSelectorProps } from './components/CounterSelector';
export { ServingActions } from './components/ServingActions';
export type { ServingActionsProps } from './components/ServingActions';
export { useQueueStatus } from './api/useQueueStatus';
export type { UseQueueStatusOptions } from './api/useQueueStatus';
export { useCounters } from './api/useCounters';
export type { UseCountersOptions } from './api/useCounters';

// Serving mutation hooks (task 8.2)
export { useCallNextTicket } from './api/useCallNextTicket';
export type { UseCallNextTicketOptions, CallNextVariables } from './api/useCallNextTicket';
export { useRecallTicket } from './api/useRecallTicket';
export type { UseRecallTicketOptions, RecallVariables } from './api/useRecallTicket';
export { useSkipTicket } from './api/useSkipTicket';
export type { UseSkipTicketOptions, SkipVariables } from './api/useSkipTicket';
export { useCompleteTicket } from './api/useCompleteTicket';
export type { UseCompleteTicketOptions, CompleteVariables } from './api/useCompleteTicket';
export { useRejoinTicket } from './api/useRejoinTicket';
export type { UseRejoinTicketOptions, RejoinVariables, RejoinResult } from './api/useRejoinTicket';
export type { ServingMutationContext } from './api/useServingMutation';

export { useCounterSelectionStore } from './stores/counter-selection-store';
export type { CounterSelectionState } from './stores/counter-selection-store';
export type { CalledTicketSummary, QueueServiceStatus, QueueStatusResponse } from './types';
