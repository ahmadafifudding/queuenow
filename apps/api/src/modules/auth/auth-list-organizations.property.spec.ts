// Feature: organization-switching, Property 1: List completeness and projection
// (this file also covers Property 2: Deterministic list ordering, and
//  Property 3: Exactly one (or zero) active entry)

import type { ConfigService } from '@nestjs/config';
import type { JwtService } from '@nestjs/jwt';
import type { Prisma } from '@queuenow/db';
import type { OrganizationMembership } from '@queuenow/shared-types';
import fc from 'fast-check';

import type { PrismaService } from '../../prisma/prisma.service';
import { AuthService } from './auth.service';

/**
 * Properties 1, 2, 3 — `AuthService.listOrganizations(userId, activeOrgId)`.
 *
 * Validates: Requirements 1.1, 1.2, 1.3, 1.4, 1.5, 1.7, 1.8, 1.10
 *
 * Property 1 (List completeness and projection): for any membership set
 * (active/inactive, empty, singleton) the method returns exactly one entry per
 * membership and each entry's `id`/`name`/`slug`/`isActive`/`role` equal the
 * source `Organization`/`UserRole` fields; inactive orgs are included and
 * distinguished only by `isActive: false`. (R1.1, R1.2, R1.3, R1.7, R1.8, R1.10)
 *
 * Property 2 (Deterministic list ordering): the result is ordered by membership
 * `createdAt` ascending, tie-broken by `orgId` in ascending Unicode code-point
 * order. (R1.4)
 *
 * Property 3 (Exactly one (or zero) active entry): exactly the single entry
 * whose `id` equals the presented `activeOrgId` is `active: true`; none when no
 * entry matches. (R1.5)
 *
 * The method reads only `prisma.userRole.findMany({ where: { userId },
 * include: { org: true } })`, sorts by `compareMemberships`, and projects. We
 * therefore instantiate the real `AuthService` with a Prisma mock whose
 * `userRole.findMany` resolves the generated membership set; `JwtService` and
 * `ConfigService` are unused by this path and stubbed.
 */

const NUM_RUNS = 100;

/**
 * One membership (`UserRole`) row with its `Organization` eagerly loaded — the
 * exact shape `listOrganizations` consumes from `findMany`.
 */
type MembershipWithOrg = Prisma.UserRoleGetPayload<{ include: { org: true } }>;

/** Minimal spec for a generated membership; only the fields the method reads vary. */
interface MembershipSpec {
  orgId: string;
  createdAtMs: number;
  isActive: boolean;
  role: 'OWNER' | 'ADMIN' | 'STAFF';
}

/**
 * Builds a fully-typed `MembershipWithOrg` row from a compact spec, following
 * the build-helper pattern from `auth-default-membership.property.spec.ts`.
 */
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
 * Independent oracle for the expected ordering: `createdAt` ascending,
 * tie-broken by `orgId` using the same `<`/`>` Unicode code-unit comparison the
 * implementation uses. Returns the source rows in expected output order.
 */
function expectedOrder(memberships: MembershipWithOrg[]): MembershipWithOrg[] {
  return [...memberships].sort((a, b) => {
    const byCreatedAt = a.createdAt.getTime() - b.createdAt.getTime();
    if (byCreatedAt !== 0) {
      return byCreatedAt;
    }
    if (a.orgId < b.orgId) {
      return -1;
    }
    if (a.orgId > b.orgId) {
      return 1;
    }
    return 0;
  });
}

// A small pool of timestamps so `createdAt` ties occur frequently across a set,
// exercising the orgId tie-break (R1.4).
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
 * orgId)` constraint). `minLength: 0` exercises the empty-set case (R1.8) and
 * short arrays exercise the singleton case (R1.7).
 */
const membershipSet = (): fc.Arbitrary<MembershipWithOrg[]> =>
  fc
    .uniqueArray(membershipSpec(), {
      minLength: 0,
      maxLength: 8,
      selector: (spec) => spec.orgId,
    })
    .map((specs) => specs.map(buildMembership));

/**
 * Builds an `AuthService` whose Prisma `userRole.findMany` resolves the given
 * membership set. `JwtService`/`ConfigService` are unused by `listOrganizations`
 * and stubbed. Per task constraints, `auth.service.ts` is NOT modified.
 */
function buildService(memberships: MembershipWithOrg[]): AuthService {
  const findMany = jest.fn().mockResolvedValue(memberships);
  const prismaMock = { userRole: { findMany } } as unknown as PrismaService;
  return new AuthService(prismaMock, {} as unknown as JwtService, {} as unknown as ConfigService);
}

/** Draws an `activeOrgId` either from the set's members or from an outside pool. */
const activeOrgIdFor = (memberships: MembershipWithOrg[]): fc.Arbitrary<string> => {
  const memberIds = memberships.map((m) => m.orgId);
  const nonMember = fc.string({ minLength: 1, maxLength: 8 });
  if (memberIds.length === 0) {
    return nonMember;
  }
  return fc.oneof(fc.constantFrom(...memberIds), nonMember);
};

describe('Properties 1-3: listOrganizations completeness, ordering, and active marking', () => {
  it('Property 1: returns exactly one entry per membership with faithful projection (R1.1, R1.2, R1.3, R1.7, R1.8, R1.10)', async () => {
    await fc.assert(
      fc.asyncProperty(membershipSet(), async (memberships) => {
        const service = buildService(memberships);
        const result = await service.listOrganizations('user-1', 'unused-active-org');

        // One entry per membership — no more, no fewer (R1.1, R1.7, R1.8, R1.10).
        expect(result).toHaveLength(memberships.length);

        // Each source membership is represented exactly once with faithful fields.
        const bySource = new Map<string, OrganizationMembership>(
          result.map((entry) => [entry.id, entry]),
        );
        expect(bySource.size).toBe(memberships.length);

        for (const membership of memberships) {
          const entry = bySource.get(membership.org.id);
          expect(entry).toBeDefined();
          expect(entry?.id).toBe(membership.org.id);
          expect(entry?.name).toBe(membership.org.name);
          expect(entry?.slug).toBe(membership.org.slug);
          expect(entry?.isActive).toBe(membership.org.isActive); // R1.3 — inactive included, flagged
          expect(entry?.role).toBe(membership.role);
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('Property 2: orders entries by createdAt asc, tie-broken by orgId asc (Unicode) (R1.4)', async () => {
    await fc.assert(
      fc.asyncProperty(membershipSet(), async (memberships) => {
        const service = buildService(memberships);
        const result = await service.listOrganizations('user-1', 'unused-active-org');

        const expectedIds = expectedOrder(memberships).map((m) => m.org.id);
        expect(result.map((entry) => entry.id)).toEqual(expectedIds);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('Property 3: marks active:true on exactly the entry whose id === activeOrgId, none otherwise (R1.5)', async () => {
    await fc.assert(
      fc.asyncProperty(
        membershipSet().chain((memberships) =>
          activeOrgIdFor(memberships).map((activeOrgId) => ({ memberships, activeOrgId })),
        ),
        async ({ memberships, activeOrgId }) => {
          const service = buildService(memberships);
          const result = await service.listOrganizations('user-1', activeOrgId);

          const activeEntries = result.filter((entry) => entry.active);
          const matchExists = memberships.some((m) => m.org.id === activeOrgId);

          if (matchExists) {
            // Exactly one active entry, and it is the matching one.
            expect(activeEntries).toHaveLength(1);
            expect(activeEntries[0]?.id).toBe(activeOrgId);
          } else {
            // No entry matches → none active.
            expect(activeEntries).toHaveLength(0);
          }

          // Every non-matching entry is inactive-marked regardless.
          for (const entry of result) {
            expect(entry.active).toBe(entry.id === activeOrgId);
          }
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  it('covers the empty membership set (R1.8)', async () => {
    const service = buildService([]);
    const result = await service.listOrganizations('user-1', 'any-org');
    expect(result).toEqual([]);
    expect(result.some((entry) => entry.active)).toBe(false);
  });

  it('covers the singleton membership set (R1.7)', async () => {
    const membership = buildMembership({
      orgId: 'org-solo',
      createdAtMs: 1_234,
      isActive: true,
      role: 'OWNER',
    });
    const service = buildService([membership]);
    const result = await service.listOrganizations('user-1', 'org-solo');

    expect(result).toHaveLength(1);
    expect(result[0]?.id).toBe('org-solo');
    expect(result[0]?.active).toBe(true);
  });
});
