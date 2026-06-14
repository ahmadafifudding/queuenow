import { PlanType } from '@queuenow/shared-types';
import { ERROR_CODES } from '@queuenow/shared-constants';

import { PlanLimitExceededException } from '../../common/exceptions/plan-limit-exceeded.exception';
import type { IAuthenticatedUser } from '../../common/interfaces';
import type { PrismaService } from '../../prisma/prisma.service';
import { PlanLimitsService } from '../plan/plan-limits.service';
import { StaffService } from './staff.service';

/**
 * Unit tests for `maxStaff` enforcement wired into `StaffService.invite`
 * (task 6.4).
 * Validates: Requirements 1.1, 1.2, 1.3, 1.4, 1.5
 *
 * Staff usage is the count of existing `UserRole` members **plus** `PENDING`
 * invitations, so an invite that will become a member cannot bypass `maxStaff`
 * (design "Staff note"). These tests exercise the real
 * `PlanLimitsService.assertWithinNumericLimit` decision path through
 * `StaffService.invite`'s `runSerializable` transaction, with a mocked Prisma,
 * and assert that pending invitations are counted toward the seat limit.
 */

const ORG_ID = 'org-1';
const USER: IAuthenticatedUser = { id: 'user-1', orgId: ORG_ID } as IAuthenticatedUser;
const DTO = { email: 'new@example.com', role: 'STAFF' as const };

interface StaffStub {
  /** Plan governing `maxStaff` (FREE ⇒ 2, BASIC ⇒ 5, PRO ⇒ null/unlimited). */
  plan: PlanType;
  /** Existing `UserRole` members for the org. */
  members: number;
  /** Existing `PENDING` invitations for the org (seats already consumed). */
  pendingInvitations: number;
}

function buildStaffService({ plan, members, pendingInvitations }: StaffStub): {
  staffService: StaffService;
  invitationCreate: jest.Mock;
  memberCount: jest.Mock;
  pendingCount: jest.Mock;
} {
  const invitationCreate = jest
    .fn()
    .mockResolvedValue({ id: 'inv-1', orgId: ORG_ID, email: DTO.email });
  const memberCount = jest.fn().mockResolvedValue(members);
  const pendingCount = jest.fn().mockResolvedValue(pendingInvitations);

  const prisma = {
    organization: {
      findUnique: jest.fn().mockResolvedValue({ plan }),
    },
    userRole: {
      count: memberCount,
      // No existing member with the invited email.
      findFirst: jest.fn().mockResolvedValue(null),
    },
    invitation: {
      count: pendingCount,
      // No existing PENDING invitation for the invited email.
      findFirst: jest.fn().mockResolvedValue(null),
      create: invitationCreate,
    },
    $transaction: jest.fn(async (work: (client: unknown) => Promise<unknown>) => work(prisma)),
  } as unknown as PrismaService;

  const planLimits = new PlanLimitsService(prisma);
  return {
    staffService: new StaffService(prisma, planLimits),
    invitationCreate,
    memberCount,
    pendingCount,
  };
}

describe('StaffService.invite maxStaff enforcement', () => {
  it('allows an invite when members + pending invitations are below the limit (R1.1)', async () => {
    // FREE: maxStaff = 2. 1 member + 0 pending = 1 < 2 ⇒ allowed.
    const { staffService, invitationCreate } = buildStaffService({
      plan: PlanType.FREE,
      members: 1,
      pendingInvitations: 0,
    });

    await expect(staffService.invite(ORG_ID, DTO, USER)).resolves.toMatchObject({ id: 'inv-1' });
    expect(invitationCreate).toHaveBeenCalledTimes(1);
  });

  it('counts pending invitations toward maxStaff and rejects at the limit (R1.2, R1.3)', async () => {
    // FREE: maxStaff = 2. 1 member + 1 pending = 2 >= 2 ⇒ rejected; no invitation created.
    const { staffService, invitationCreate, memberCount, pendingCount } = buildStaffService({
      plan: PlanType.FREE,
      members: 1,
      pendingInvitations: 1,
    });

    try {
      await staffService.invite(ORG_ID, DTO, USER);
      throw new Error('expected rejection');
    } catch (error) {
      expect(error).toBeInstanceOf(PlanLimitExceededException);
      const response = (error as PlanLimitExceededException).getResponse() as {
        code: string;
        details: { limitName: string; limit: number; currentUsage: number; plan: PlanType };
      };
      expect(response.code).toBe(ERROR_CODES.PLAN_LIMIT_EXCEEDED);
      expect(response.details).toMatchObject({
        limitName: 'maxStaff',
        limit: 2,
        // currentUsage = members (1) + pending invitations (1).
        currentUsage: 2,
        plan: PlanType.FREE,
      });
      expect((error as PlanLimitExceededException).getStatus()).toBe(403);
    }

    // Both counts contribute to the seat total, and no invitation is created on reject.
    expect(memberCount).toHaveBeenCalledTimes(1);
    expect(pendingCount).toHaveBeenCalledTimes(1);
    expect(invitationCreate).not.toHaveBeenCalled();
  });

  it('rejects when members alone exceed the limit (R1.2)', async () => {
    // BASIC: maxStaff = 5. 6 members + 0 pending = 6 > 5 ⇒ rejected.
    const { staffService, invitationCreate } = buildStaffService({
      plan: PlanType.BASIC,
      members: 6,
      pendingInvitations: 0,
    });

    await expect(staffService.invite(ORG_ID, DTO, USER)).rejects.toBeInstanceOf(
      PlanLimitExceededException,
    );
    expect(invitationCreate).not.toHaveBeenCalled();
  });

  it('treats a null limit as unlimited and invites regardless of usage (R1.4)', async () => {
    // PRO: maxStaff = null. Even large member + pending counts are allowed and never counted.
    const { staffService, invitationCreate, memberCount, pendingCount } = buildStaffService({
      plan: PlanType.PRO,
      members: 500,
      pendingInvitations: 500,
    });

    await expect(staffService.invite(ORG_ID, DTO, USER)).resolves.toMatchObject({ id: 'inv-1' });
    expect(invitationCreate).toHaveBeenCalledTimes(1);
    expect(memberCount).not.toHaveBeenCalled();
    expect(pendingCount).not.toHaveBeenCalled();
  });
});
