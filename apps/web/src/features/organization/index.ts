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

// Plan & Usage surface + manual plan-change dialog (R8, R6).
export { PlanUsageView } from './components/PlanUsageView';
export { PlanChangeDialog } from './components/PlanChangeDialog';
export type { PlanChangeDialogProps } from './components/PlanChangeDialog';

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

// Plan-limit error handling (R8.5).
export { isPlanLimitExceeded, onPlanLimitError } from './lib/plan-limit-error';
export type { ShowUpgradePrompt } from './lib/plan-limit-error';
export { showUpgradePrompt } from './lib/upgrade-prompt';

// Pure plan-usage helpers (R8.2, R8.3, R8.4).
export { formatUsage, atLimitResources, UNLIMITED_LABEL } from './lib/format-usage';
