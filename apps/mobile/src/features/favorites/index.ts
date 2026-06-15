/**
 * Favorites feature barrel (R8).
 *
 * Exposes the favorites query/mutation hooks (`useFavorites`, `useAddFavorite`,
 * `useRemoveFavorite`), the `FavoritesList` screen component delegated to from
 * the thin `app/(account)/favorites` route, and the feature view-model types.
 */
export {
  useAddFavorite,
  useFavorites,
  useRemoveFavorite,
  type UseFavoritesDeps,
} from './use-favorites';
export { isOrgFavorited } from './favorite-selectors';
export { FavoritesList } from './components/FavoritesList';
export { FavoriteToggle, type FavoriteToggleProps } from './components/FavoriteToggle';
export type { FavoriteItem, FavoriteOrganization } from './types';
