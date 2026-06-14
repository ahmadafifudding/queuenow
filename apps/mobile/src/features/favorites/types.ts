/**
 * Favorites feature types (R8 — favorite organizations).
 *
 * These compose the shared domain type from `@queuenow/shared-types`
 * (`IOrganization`); the app NEVER redefines shared domain types (R10.5,
 * R14.5). The favorites endpoint (`GET /customers/favorites`) is a
 * backend-specific projection — each entry is a `CustomerFavorite` row plus the
 * subset of organization fields the backend selects — so {@link FavoriteItem}
 * is a thin app-local view model built from the shared org type via `Pick`.
 */
import type { IOrganization } from '@queuenow/shared-types';

/**
 * The subset of {@link IOrganization} fields the backend includes alongside each
 * favorite (see `CustomerService.getFavorites`: `id`, `name`, `slug`, `type`,
 * `address`). Picked from the shared type rather than redefined.
 */
export type FavoriteOrganization = Pick<IOrganization, 'id' | 'name' | 'slug' | 'type' | 'address'>;

/**
 * A single favorites entry as returned by `GET /customers/favorites`. The
 * backend filters the joined organization to active ones, so `organization` may
 * be absent for a favorite whose org is no longer active; the screen renders
 * only entries that still resolve to an organization (R8.4).
 */
export interface FavoriteItem {
  /** The `CustomerFavorite` row id. */
  id: string;
  /** The favorited organization's id (the route param for view-services). */
  orgId: string;
  /** When the favorite was created (ISO-8601); the backend orders by this desc. */
  createdAt: string;
  /** The resolved organization details, or `undefined` if the org is inactive. */
  organization?: FavoriteOrganization;
}
