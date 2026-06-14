// Feature: organization-switching, Property 4: Deterministic default-organization selection

import type { ConfigService } from '@nestjs/config';
import type { JwtService } from '@nestjs/jwt';
import type { Prisma } from '@queuenow/db';
import fc from 'fast-check';

import type { PrismaService } from '../../prisma/prisma.service';
import { AuthService } from './auth.service';

/**
 * Property 4 — Deterministic default-organization selection.
 * Validates: Requirements 4.1, 4.2, 4.3, 4.4
 *
 * For any set of memberships, `selectDefaultMembership` selects the eligible
 * membership (one whose organization `isActive` is true) with the earliest
 * `createdAt`, breaking ties by the smallest `orgId` in ascending Unicode
 * code-point order, and never selects a membership whose organization is
 * inactive even when it has an earlier `createdAt`. Returns `null` when no
 * eligible (active) membership exists (empty set or all-inactive).
 *
 * The method under test is the private `selectDefaultMembership` on
 * `AuthService`. We instantiate `AuthService` with stubbed dependencies (the
 * selection logic uses none of them) and reach the private method via a typed
 * bracket-notation cast, binding it so its internal `this.compareMemberships`
 * call resolves.
 */

const NUM_RUNS = 200;

/**
 * One membership (`UserRole`) row with its `Organization` eagerly loaded —
 * the exact shape `selectDefaultMembership` consumes.
 */
type MembershipWithOrg = Prisma.UserRoleGetPayload<{ include: { org: true } }>;

type SelectDefaultMembership = (memberships: MembershipWithOrg[]) => MembershipWithOrg | null;

/** Minimal spec for a generated membership; only the fields the rule reads vary. */
interface MembershipSpec {
  orgId: string;
  createdAtMs: number;
  isActive: boolean;
  role: 'OWNER' | 'ADMIN' | 'STAFF';
}

function buildMembership(spec: MembershipSpec): MembershipWithOrg {
  const createdAt = new Date(spec.createdAtMs);
  return {
    id: `role-${spec.orgId}`,
    userId: 'user-1',
    orgId: spec.orgId,
    role: spec.role,
    assignedServiceId: null,
    createdAt,
    org: {
      id: spec.orgId,
      name: `Org ${spec.orgId}`,
      slug: `org-${spec.orgId}`,
      type: 'CLINIC',
      address: null,
      phone: null,
      email: null,
      plan: 'FREE',
      ownerId: 'user-1',
      timezone: 'Asia/Kuala_Lumpur',
      isActive: spec.isActive,
      createdAt,
      updatedAt: createdAt,
    },
  };
}

/**
 * Independent oracle for the deterministic default: filter to active orgs,
 * then pick the earliest `createdAt`, tie-broken by smallest `orgId` (the same
 * `<`/`>` Unicode code-unit comparison the implementation uses).
 */
function expectedDefault(memberships: MembershipWithOrg[]): MembershipWithOrg | null {
  const active = memberships.filter((m) => m.org.isActive === true);
  if (active.length === 0) {
    return null;
  }
  return active.reduce((best, m) => {
    const delta = m.createdAt.getTime() - best.createdAt.getTime();
    if (delta < 0) {
      return m;
    }
    if (delta > 0) {
      return best;
    }
    return m.orgId < best.orgId ? m : best;
  });
}

// A small pool of timestamps so `createdAt` ties occur frequently across a set.
const TIE_PRONE_TIMESTAMPS = [1_000, 1_000, 2_000, 2_000, 3_000];

const membershipSpec = (): fc.Arbitrary<MembershipSpec> =>
  fc.record({
    orgId: fc.string({ minLength: 1, maxLength: 6 }),
    createdAtMs: fc.constantFrom(...TIE_PRONE_TIMESTAMPS),
    isActive: fc.boolean(),
    role: fc.constantFrom<'OWNER' | 'ADMIN' | 'STAFF'>('OWNER', 'ADMIN', 'STAFF'),
  });

/**
 * A membership set with distinct `orgId`s (enforced by the `@@unique(userId,
 * orgId)` constraint). `minLength: 0` exercises the empty-set case and short
 * arrays exercise the singleton case.
 */
const membershipSet = (): fc.Arbitrary<MembershipWithOrg[]> =>
  fc
    .uniqueArray(membershipSpec(), {
      minLength: 0,
      maxLength: 8,
      selector: (spec) => spec.orgId,
    })
    .map((specs) => specs.map(buildMembership));

function getSelectDefaultMembership(): SelectDefaultMembership {
  const service = new AuthService(
    {} as unknown as PrismaService,
    {} as unknown as JwtService,
    {} as unknown as ConfigService,
  );
  const internal = service as unknown as { selectDefaultMembership: SelectDefaultMembership };
  return internal.selectDefaultMembership.bind(service);
}

describe('Property 4: Deterministic default-organization selection', () => {
  const selectDefaultMembership = getSelectDefaultMembership();

  it('matches an independent earliest-createdAt / smallest-orgId oracle (R4.1, R4.2, R4.3, R4.4)', () => {
    fc.assert(
      fc.property(membershipSet(), (memberships) => {
        const result = selectDefaultMembership(memberships);
        const expected = expectedDefault(memberships);

        if (expected === null) {
          expect(result).toBeNull();
        } else {
          expect(result).not.toBeNull();
          expect(result?.orgId).toBe(expected.orgId);
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('never selects a membership whose organization is inactive (R4.4)', () => {
    fc.assert(
      fc.property(membershipSet(), (memberships) => {
        const result = selectDefaultMembership(memberships);
        if (result !== null) {
          expect(result.org.isActive).toBe(true);
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('returns the active membership with the earliest createdAt (R4.1)', () => {
    fc.assert(
      fc.property(membershipSet(), (memberships) => {
        const result = selectDefaultMembership(memberships);
        const active = memberships.filter((m) => m.org.isActive === true);
        if (result === null) {
          expect(active).toHaveLength(0);
          return;
        }
        const earliest = Math.min(...active.map((m) => m.createdAt.getTime()));
        expect(result.createdAt.getTime()).toBe(earliest);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('breaks createdAt ties by the smallest orgId in ascending Unicode order (R4.2)', () => {
    // All-active, all-same-createdAt sets isolate the tie-break rule.
    const tiedSet = (): fc.Arbitrary<MembershipWithOrg[]> =>
      fc
        .uniqueArray(fc.string({ minLength: 1, maxLength: 6 }), {
          minLength: 1,
          maxLength: 8,
        })
        .map((orgIds) =>
          orgIds.map((orgId) =>
            buildMembership({ orgId, createdAtMs: 5_000, isActive: true, role: 'STAFF' }),
          ),
        );

    fc.assert(
      fc.property(tiedSet(), (memberships) => {
        const result = selectDefaultMembership(memberships);
        const smallestOrgId = memberships
          .map((m) => m.orgId)
          .reduce((min, id) => (id < min ? id : min));
        expect(result?.orgId).toBe(smallestOrgId);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('returns the single eligible membership for a singleton active set (R4.3)', () => {
    fc.assert(
      fc.property(fc.string({ minLength: 1, maxLength: 6 }), (orgId) => {
        const memberships = [
          buildMembership({ orgId, createdAtMs: 1_234, isActive: true, role: 'ADMIN' }),
        ];
        const result = selectDefaultMembership(memberships);
        expect(result?.orgId).toBe(orgId);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('returns null for the empty set and for all-inactive sets (R4.4)', () => {
    expect(selectDefaultMembership([])).toBeNull();

    fc.assert(
      fc.property(
        fc.uniqueArray(fc.string({ minLength: 1, maxLength: 6 }), {
          minLength: 1,
          maxLength: 8,
        }),
        (orgIds) => {
          const memberships = orgIds.map((orgId) =>
            buildMembership({ orgId, createdAtMs: 1_000, isActive: false, role: 'OWNER' }),
          );
          expect(selectDefaultMembership(memberships)).toBeNull();
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });
});
