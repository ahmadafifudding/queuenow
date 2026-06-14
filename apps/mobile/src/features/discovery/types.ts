/**
 * Discovery feature types (R1).
 *
 * These compose the shared domain types from `@queuenow/shared-types`
 * (`IOrganization`, `IService`) and the backend's public queue-status response
 * shape. The app NEVER redefines shared domain types (R10.5, R14.5); the types
 * here are either client-only view models (`DiscoveryTarget`) or explicit
 * mirrors of the computed status aggregate that has no backend DTO (the same
 * approach `apps/web` takes in `features/queue/types.ts`).
 */
import type { IOrganization, IService } from '@queuenow/shared-types';

/**
 * Where a {@link DiscoveryTarget} came from: a scanned QR deep link (R1.1) or a
 * manually entered organization code (R1.2).
 */
export type DiscoverySource = 'qr' | 'manual';

/**
 * The parsed result of a scanned QR deep link or a manual code entry.
 *
 * The QR payload produced by the backend `qr-code.service` is a deep link of the
 * shape `{base}/join/{slug}?service={serviceId}` (design "Discovery note",
 * R1.1). Parsing yields the `slug` and optional `serviceId`. Because the public
 * status endpoint is org-id-scoped (see {@link resolveOrgIdentifier}), an
 * `orgId` may also be present when the caller already knows it.
 *
 * This is a CLIENT-ONLY view model (composition, not a redefinition of a shared
 * type) — it references {@link IOrganization.slug} / {@link IService.id} only by
 * value, never re-declaring those entities.
 */
export interface DiscoveryTarget {
  /** Organization slug from the deep-link path (`IOrganization['slug']`). */
  slug?: IOrganization['slug'];
  /** Organization id, when already known (`IOrganization['id']`). */
  orgId?: IOrganization['id'];
  /** Selected service id from a service-specific QR (`IService['id']`), if any. */
  serviceId?: IService['id'];
  /** How this target was discovered. */
  source: DiscoverySource;
}

/**
 * One active service within the org queue-status response, narrowed to the
 * fields discovery + service selection need. Mirrors the per-service entry the
 * backend `QueueService.getCurrentStatus` returns (no backend DTO exists, so it
 * is typed explicitly here).
 */
export interface DiscoveryServiceStatus {
  /** The active service (id/name/prefix come from `IService`). */
  service: Pick<IService, 'id' | 'name' | 'prefix'>;
  /** Count of tickets still WAITING today. */
  waiting: number;
  /** Count of tickets currently being SERVED. */
  serving: number;
  /** Estimated wait for a new joiner, in minutes. */
  estimatedWaitMinutes: number;
}

/**
 * The full public queue-status payload for an organization
 * (`GET /organizations/:orgId/queue/status`). Only ACTIVE services are present
 * (the backend filters `isActive: true`), so a non-empty `services` array means
 * the org is active and joinable (R1.1, R1.4).
 */
export interface OrgQueueStatus {
  /** The organization id the status belongs to (`IOrganization['id']`). */
  organizationId: IOrganization['id'];
  /** Display name of the organization (`IOrganization['name']`). */
  organizationName: IOrganization['name'];
  /** One snapshot per ACTIVE service. */
  services: DiscoveryServiceStatus[];
  /** ISO-8601 timestamp of when the status was computed. */
  lastUpdated: string;
}

/**
 * A normalized active service for the join-availability decision and the
 * selection UI. Derived from {@link DiscoveryServiceStatus} so the pure decision
 * function stays decoupled from the raw response shape.
 */
export interface DiscoveryServiceSummary {
  /** Service id (`IService['id']`). */
  id: IService['id'];
  /** Service name (`IService['name']`). */
  name: IService['name'];
  /** Service prefix (`IService['prefix']`). */
  prefix: IService['prefix'];
  /** Count of tickets still WAITING. */
  waiting: number;
  /** Estimated wait for a new joiner, in minutes. */
  estimatedWaitMinutes: number;
}

/**
 * Input to the pure {@link joinAvailability} decision. Exactly one of the two
 * outcomes is meaningful at a time: either resolution failed with an
 * `errorCode`, or it succeeded with the org's active `services`.
 */
export interface JoinAvailabilityInput {
  /**
   * The backend `error.code` when status resolution failed (e.g.
   * `ORG_NOT_FOUND`, `ORG_INACTIVE`), or `null`/`undefined` on success.
   */
  errorCode?: string | null;
  /** The org's active services on success (empty array allowed). */
  services?: DiscoveryServiceSummary[];
}

/**
 * The pure join-availability decision (R1.3, R1.4). Side-effect free so it can
 * be exercised by the Property 2 test (task 7.3).
 */
export interface JoinAvailabilityDecision {
  /** Present a join action IFF an active org exposes ≥1 active service (R1.4). */
  presentJoinAction: boolean;
  /** Show an error (resolution failed, e.g. `ORG_NOT_FOUND`/`ORG_INACTIVE`) (R1.3). */
  showError: boolean;
  /** The resolution error code when {@link showError}, else `null`. */
  errorCode: string | null;
  /** Active org with zero active services — render the "no services" empty state. */
  isEmpty: boolean;
  /** Require explicit service selection when more than one active service (R1.4). */
  requiresServiceSelection: boolean;
  /** The active services to render (empty when error/empty). */
  services: DiscoveryServiceSummary[];
  /** The single auto-selectable service id when exactly one is active, else `null`. */
  preselectedServiceId: string | null;
}
