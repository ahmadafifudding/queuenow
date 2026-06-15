// Feature: customer-mobile-app, favorites add/remove UI
//
// Validates: Requirements 8.2, 8.3
//
// Unit tests for the pure `isOrgFavorited` selector that drives the
// FavoriteToggle label/action and the FavoritesList remove control. Pure and
// React-free, so it runs directly in the headless `node` test environment.
import { describe, expect, it } from 'vitest';

import { isOrgFavorited } from '../favorite-selectors';
import type { FavoriteItem } from '../types';

function favorite(orgId: string, withOrg = true): FavoriteItem {
  return {
    id: `fav_${orgId}`,
    orgId,
    createdAt: '2024-01-02T10:00:00.000Z',
    organization: withOrg
      ? ({
          id: orgId,
          name: `Org ${orgId}`,
          slug: `org-${orgId}`,
          type: 'CLINIC',
          address: '1 Main St',
        } as FavoriteItem['organization'])
      : undefined,
  };
}

describe('isOrgFavorited', () => {
  it('returns true when the org id is present in the list (R8.3)', () => {
    const items = [favorite('org_1'), favorite('org_2')];
    expect(isOrgFavorited(items, 'org_2')).toBe(true);
  });

  it('returns false when the org id is absent (R8.2)', () => {
    const items = [favorite('org_1')];
    expect(isOrgFavorited(items, 'org_999')).toBe(false);
  });

  it('matches on orgId even when the joined organization is inactive/undefined (R8.4)', () => {
    // An inactive org resolves `organization` to undefined, but the favorite
    // row still carries the canonical orgId the endpoints are keyed on.
    const items = [favorite('org_3', false)];
    expect(isOrgFavorited(items, 'org_3')).toBe(true);
  });

  it('returns false for undefined data (query not yet resolved)', () => {
    expect(isOrgFavorited(undefined, 'org_1')).toBe(false);
  });

  it('returns false for an empty org id, never matching a row', () => {
    const items = [favorite('')];
    expect(isOrgFavorited(items, '')).toBe(false);
  });
});
