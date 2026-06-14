/*
 * Public surface of the services feature (task 11.1). Routes and other features
 * import from here rather than reaching into internals.
 */
export { ServicesView } from './components/ServicesView';
export { ServicesList, type ServicesListProps } from './components/ServicesList';
export { ServiceForm, type ServiceFormProps } from './components/ServiceForm';

export { useServices, type UseServicesOptions } from './api/useServices';
export { useCreateService, type UseCreateServiceOptions } from './api/useCreateService';
export {
  useUpdateService,
  type UseUpdateServiceOptions,
  type UpdateServiceVariables,
} from './api/useUpdateService';
export {
  useToggleService,
  type UseToggleServiceOptions,
  type ToggleServiceVariables,
} from './api/useToggleService';

export { serviceEndpoints } from './api/endpoints';
