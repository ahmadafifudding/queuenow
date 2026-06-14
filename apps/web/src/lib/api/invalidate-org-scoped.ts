/*
 * Org-scoped cache invalidation helper (organization-switching R5.10, R5.12).
 *
 * After a successful organization switch, no data belonging to the *previous*
 * org may remain on screen. Every org-scoped query key in the central
 * `queryKeys` factory is keyed by `orgId` as its first element's namespace
 * (`['queue', orgId, …]`, `['services', orgId]`, `['counters', orgId]`,
 * `['staff', orgId, page]`, `['ticket', orgId, …]`, `['org-stats', orgId]`,
 * `['organization', orgId]`, `['plan-usage', orgId]`). The only key that is NOT
 * org-scoped is `['organizations']` — the user's membership list — which is
 * identical across orgs and must survive a switch.
 *
 * This helper uses `removeQueries` (not `invalidateQueries`) so stale
 * previous-org data is dropped immediately rather than shown until the next
 * refetch: the new access token would otherwise refetch the *new* org's data
 * under the *same* key only after the next render. Active queries then re-fetch
 * under the new `orgId` because their components read `organization.id` from the
 * (now updated) auth store. On switch failure the mutation's `onSuccess` never
 * runs, so token, org, and caches are all left intact (R5.12).
 */
import type { QueryClient } from '@tanstack/react-query';

/**
 * First-element prefixes of every org-scoped query key. Mirrors the org-scoped
 * entries of the central `queryKeys` factory. `'organizations'` is deliberately
 * excluded because the membership list is user-scoped and must outlive a switch.
 */
export const ORG_SCOPED_PREFIXES = [
  'queue',
  'services',
  'counters',
  'staff',
  'ticket',
  'org-stats',
  'organization',
  'plan-usage',
] as const;

/**
 * Remove every cached query whose key begins with an org-scoped prefix, leaving
 * all other keys (in particular the user-scoped `['organizations']` membership
 * list) untouched. Called from the org-switch mutation's `onSuccess` so no data
 * from the previous organization can render after a switch (R5.10).
 */
export function invalidateOrgScopedQueries(queryClient: QueryClient): void {
  const prefixes: readonly string[] = ORG_SCOPED_PREFIXES;
  queryClient.removeQueries({
    predicate: (query) => prefixes.includes(query.queryKey[0] as string),
  });
}
