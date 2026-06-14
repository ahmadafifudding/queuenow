/*
 * Public surface of the organization feature (Phase 3, R11). Routes and other
 * features import from here rather than reaching into internals.
 */

// Settings page (orchestrates queries, forms, branding-on-load, delete control).
export { OrganizationSettingsView } from './components/OrganizationSettingsView';

// Individual forms / controls.
export { OrganizationDetailsForm } from './components/OrganizationDetailsForm';
export type { OrganizationDetailsFormProps } from './components/OrganizationDetailsForm';
export { BrandingForm } from './components/BrandingForm';
export type { BrandingFormProps } from './components/BrandingForm';
export { QueueSettingsForm } from './components/QueueSettingsForm';
export type { QueueSettingsFormProps } from './components/QueueSettingsForm';
export { DeleteOrganizationControl } from './components/DeleteOrganizationControl';
export type { DeleteOrganizationControlProps } from './components/DeleteOrganizationControl';

// Query / mutation hooks.
export { useOrganization } from './api/useOrganization';
export type { UseOrganizationOptions } from './api/useOrganization';
export { useQueueSettings, queueSettingsKey } from './api/useQueueSettings';
export type { UseQueueSettingsOptions } from './api/useQueueSettings';
export { useUpdateOrganization } from './api/useUpdateOrganization';
export { useUpdateBranding } from './api/useUpdateBranding';
export { useUpdateQueueSettings } from './api/useUpdateQueueSettings';
export { useDeleteOrganization } from './api/useDeleteOrganization';

// Endpoints + types.
export { organizationEndpoints } from './api/endpoints';
export type { OrganizationBranding, OrganizationDetails, QueueSettings } from './types';
