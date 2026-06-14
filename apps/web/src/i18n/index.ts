import { type Catalog, en } from './en';

/**
 * The active string catalog. English is the only language for the MVP; when a
 * second language ships, swap or select the catalog here (e.g. based on a user
 * preference) without touching call sites. Every catalog must match the
 * {@link Catalog} shape so the typed accessors below stay valid.
 */
export const strings: Catalog = en;

export type { Catalog } from './en';

/**
 * Tiny typed accessor for top-level UI strings. Keeps call sites declarative
 * (`t('common', 'retry')`) and ready to grow into a fuller i18n layer later.
 */
export function t<S extends keyof Catalog['common']>(
  section: 'common',
  key: S,
): Catalog['common'][S];
export function t(section: 'common', key: keyof Catalog['common']): string {
  return strings[section][key];
}
