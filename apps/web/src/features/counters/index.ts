/*
 * Public surface of the counters management feature (task 12.1). Routes and
 * other features import from here rather than reaching into internals.
 */
export { CountersView } from './components/CountersView';
export { CounterList } from './components/CounterList';
export type { CounterListProps } from './components/CounterList';
export { CounterForm } from './components/CounterForm';
export type { CounterFormProps } from './components/CounterForm';

export { useCounters } from './api/useCounters';
export type { UseCountersOptions } from './api/useCounters';
export { useServices } from './api/useServices';
export type { UseServicesOptions } from './api/useServices';
export { useCreateCounter } from './api/useCreateCounter';
export type { UseCreateCounterOptions } from './api/useCreateCounter';
export { useUpdateCounter } from './api/useUpdateCounter';
export type { UseUpdateCounterOptions, UpdateCounterVariables } from './api/useUpdateCounter';
export { useToggleCounter } from './api/useToggleCounter';
export type { UseToggleCounterOptions, ToggleCounterVariables } from './api/useToggleCounter';

export { counterEndpoints } from './api/endpoints';
