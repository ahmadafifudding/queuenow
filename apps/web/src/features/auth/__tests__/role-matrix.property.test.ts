// Feature: web-app, Property 7: Role-based visibility equals the capability matrix

import fc from 'fast-check';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, renderHook } from '@testing-library/react';
import { UserRoleType } from '@queuenow/shared-types';

import {
  CAPABILITY_MATRIX,
  type Capability,
  roleHasCapability,
} from '@/features/auth/capabilities';
import { useHasCapability } from '@/features/auth/hooks/useHasRole';
import { useAuthStore } from '@/features/auth/stores/auth-store';

/**
 * Property 7 — Role-based visibility equals the capability matrix.
 * Validates: Requirements 5.2, 5.3, 5.5, 5.6, 5.7, 10.6, 11.7
 *
 * The capability matrix is the oracle. To avoid the test trivially mirroring the
 * implementation, we first pin an INDEPENDENT, hand-written expected matrix
 * (transcribed from the steering "Role-Based UI" table in `frontend-web.md`) and
 * assert `CAPABILITY_MATRIX` equals it. That fixes the requirement in place.
 *
 * We then run the property over {OWNER, ADMIN, STAFF, null} × every capability:
 *   - Pure core: `roleHasCapability(role, cap)` equals the membership predicate
 *     `role !== null && matrix[cap].includes(role)`.
 *   - Behavioral: with the auth store set to `role`, the `useHasCapability(cap)`
 *     hook (which `<RoleGate capability>` is built on) returns `true` IFF the
 *     (hand-written) matrix permits it.
 *
 * Approach: behavioral checks drive the `useHasCapability` hook with React
 * Testing Library's `renderHook`; the store is reset and the React tree cleaned
 * between every generated case.
 */

const RUNS = 200;

/**
 * Independent expected matrix, hand-transcribed from the steering table — NOT
 * imported from the implementation. This is the requirement-pinning oracle.
 *
 * | Capability                  | OWNER | ADMIN | STAFF |
 * | --------------------------- | :---: | :---: | :---: |
 * | serve-queue                 |   ✓   |   ✓   |   ✓   |
 * | manage-services-counters    |   ✓   |   ✓   |   –   |
 * | manage-staff                |   ✓   |   ✓   |   –   |
 * | manage-org-settings         |   ✓   |   ✓   |   –   |
 * | manage-billing              |   ✓   |   –   |   –   |
 * | delete-organization         |   ✓   |   –   |   –   |
 */
const EXPECTED_MATRIX: Record<Capability, readonly UserRoleType[]> = {
  'serve-queue': [UserRoleType.OWNER, UserRoleType.ADMIN, UserRoleType.STAFF],
  'manage-services-counters': [UserRoleType.OWNER, UserRoleType.ADMIN],
  'manage-staff': [UserRoleType.OWNER, UserRoleType.ADMIN],
  'manage-org-settings': [UserRoleType.OWNER, UserRoleType.ADMIN],
  'manage-billing': [UserRoleType.OWNER],
  'delete-organization': [UserRoleType.OWNER],
};

const ALL_CAPABILITIES = Object.keys(EXPECTED_MATRIX) as Capability[];

/** Roles under test, including the unauthenticated (`null`) case. */
const ROLES: readonly (UserRoleType | null)[] = [
  UserRoleType.OWNER,
  UserRoleType.ADMIN,
  UserRoleType.STAFF,
  null,
];

/** Order-independent comparison of two role lists (the matrix lists are sets). */
function sortedRoles(roles: readonly UserRoleType[]): UserRoleType[] {
  return [...roles].sort();
}

/** Set the active role in the auth store (or clear it for the `null` case). */
function setActiveRole(role: UserRoleType | null): void {
  if (role === null) {
    useAuthStore.setState({ organization: null, status: 'unauthenticated' });
    return;
  }
  useAuthStore.setState({
    organization: { id: 'o1', name: 'Acme', slug: 'acme', role },
    status: 'authenticated',
  });
}

const roleArb = (): fc.Arbitrary<UserRoleType | null> => fc.constantFrom(...ROLES);
const capabilityArb = (): fc.Arbitrary<Capability> => fc.constantFrom(...ALL_CAPABILITIES);

describe('Property 7: role-based visibility equals the capability matrix', () => {
  afterEach(() => {
    cleanup();
    useAuthStore.getState().clear();
  });

  it('pins the requirement: CAPABILITY_MATRIX deep-equals the hand-written expected matrix', () => {
    // Same capability keys, no more, no less.
    expect(Object.keys(CAPABILITY_MATRIX).sort()).toEqual(Object.keys(EXPECTED_MATRIX).sort());

    // Same permitted-role set per capability (order-independent).
    for (const capability of ALL_CAPABILITIES) {
      expect(sortedRoles(CAPABILITY_MATRIX[capability])).toEqual(
        sortedRoles(EXPECTED_MATRIX[capability]),
      );
    }
  });

  it('Property A (pure core): roleHasCapability equals matrix membership for every role × capability', () => {
    fc.assert(
      fc.property(roleArb(), capabilityArb(), (role, capability) => {
        const expected = role !== null && EXPECTED_MATRIX[capability].includes(role);
        expect(roleHasCapability(role, capability)).toBe(expected);
      }),
      { numRuns: RUNS },
    );
  });

  it('Property B (behavioral): useHasCapability returns true IFF the matrix permits, for every role × capability', () => {
    fc.assert(
      fc.property(roleArb(), capabilityArb(), (role, capability) => {
        setActiveRole(role);

        const expected = role !== null && EXPECTED_MATRIX[capability].includes(role);

        const { result } = renderHook(() => useHasCapability(capability));
        expect(result.current).toBe(expected);

        // Reset between generated cases so renders/state never leak.
        cleanup();
        useAuthStore.getState().clear();
      }),
      { numRuns: RUNS },
    );
  });

  it('covers the requirement-mandated rows explicitly (serve-queue all roles; manage-* owner/admin; billing & delete owner-only)', () => {
    // serve-queue: OWNER, ADMIN, STAFF — Requirements 5.5, 10.6, 11.7
    expect(roleHasCapability(UserRoleType.OWNER, 'serve-queue')).toBe(true);
    expect(roleHasCapability(UserRoleType.ADMIN, 'serve-queue')).toBe(true);
    expect(roleHasCapability(UserRoleType.STAFF, 'serve-queue')).toBe(true);

    // services/counters, staff, settings: OWNER, ADMIN only — Requirements 5.3, 5.6
    for (const capability of [
      'manage-services-counters',
      'manage-staff',
      'manage-org-settings',
    ] as const) {
      expect(roleHasCapability(UserRoleType.OWNER, capability)).toBe(true);
      expect(roleHasCapability(UserRoleType.ADMIN, capability)).toBe(true);
      expect(roleHasCapability(UserRoleType.STAFF, capability)).toBe(false);
    }

    // billing & delete-organization: OWNER only — Requirement 5.7
    for (const capability of ['manage-billing', 'delete-organization'] as const) {
      expect(roleHasCapability(UserRoleType.OWNER, capability)).toBe(true);
      expect(roleHasCapability(UserRoleType.ADMIN, capability)).toBe(false);
      expect(roleHasCapability(UserRoleType.STAFF, capability)).toBe(false);
    }

    // Unauthenticated sees nothing, for every capability — Requirement 5.2
    for (const capability of ALL_CAPABILITIES) {
      expect(roleHasCapability(null, capability)).toBe(false);
    }
  });
});
