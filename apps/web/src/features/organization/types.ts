/*
 * Local response types for the organization feature.
 *
 * `@queuenow/shared-types` defines `IOrganization` but does not yet ship
 * dedicated branding / queue-settings interfaces. These types model the shapes
 * returned by the apps/api `OrganizationService` (verified against
 * `organization.service.ts`) so the feature stays strictly typed without `any`.
 * They live here (app-local) rather than in the generated `schema.d.ts` until
 * the backend Swagger covers these endpoints.
 */
import type { IOrganization } from '@queuenow/shared-types';

/**
 * Per-organization branding record (R11.2). `primaryColor` is a hex string
 * (e.g. `#3B82F6`) per `updateBrandingSchema`; it is injected verbatim into the
 * `--primary` CSS variable on load (R11.3) via `lib/theme.ts`.
 */
export interface OrganizationBranding {
  orgId: string;
  logoUrl?: string | null;
  primaryColor: string;
  qrText?: string | null;
}

/**
 * Per-organization queue settings (R11.6). Mirrors the `QueueSettings` record /
 * defaults returned by the backend (`getSettings`).
 */
export interface QueueSettings {
  orgId: string;
  resetTime: string;
  maxRecall: number;
  requireName: boolean;
  requirePhone: boolean;
  autoSkipTimeout?: number | null;
  customFields?: unknown;
}

/**
 * Organization details as returned by `GET /organizations/:id`, which includes
 * the related `branding` and `settings` records (and more we don't consume
 * here). Branding/settings may be `null` before they are first configured.
 */
export interface OrganizationDetails extends IOrganization {
  branding?: OrganizationBranding | null;
  settings?: QueueSettings | null;
}
