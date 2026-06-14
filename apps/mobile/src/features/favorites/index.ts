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
export { FavoritesList } from './components/FavoritesList';
export type { FavoriteItem, FavoriteOrganization } from './types';
