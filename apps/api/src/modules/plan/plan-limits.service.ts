import { Injectable } from '@nestjs/common';
import { InvitationStatus } from '@queuenow/db';
import type { Prisma } from '@queuenow/db';
import { ERROR_CODES, PLAN_LIMITS, QUEUE_DEFAULTS } from '@queuenow/shared-constants';
import type {
  FeatureFlag,
  NumericResource,
  PlanLimitName,
  PlanType,
  PlanUsageResource,
  PlanUsageResponse,
} from '@queuenow/shared-types';

import { OrgNotFoundException } from '../../common/exceptions/org-not-found.exception';
import { PlanLimitExceededException } from '../../common/exceptions/plan-limit-exceeded.exception';
import { PrismaService } from '../../prisma/prisma.service';
import { resolveDailyWindow } from './plan-window.util';

/** The resolved `PLAN_LIMITS` entry for a single plan. */
export type PlanLimits = (typeof PLAN_LIMITS)[PlanType];

/**
 * Maps each {@link NumericResource} to the named numeric `PLAN_LIMITS` field
 * that governs it. This is the single source of truth for the resource → limit
 * mapping reused by both the pure decision logic here and the atomic
 * transactional enforcement added in later tasks.
 */
export const RESOURCE_TO_LIMIT_NAME: Readonly<Record<NumericResource, PlanLimitName>> = {
  services: 'maxServices',
  counters: 'maxCounters',
  staff: 'maxStaff',
  queuePerDay: 'maxQueuePerDay',
};

/**
 * The resolved numeric limit for a resource: the governing `PLAN_LIMITS` field
 * name and its value (`null` ⇒ unlimited).
 */
export interface ResolvedNumericLimit {
  limitName: PlanLimitName;
  /** `null` means the resource is unlimited for the resolved plan. */
  limit: number | null;
}

/**
 * The pure ALLOW/REJECT outcome of a numeric-limit decision. A rejection always
 * carries the `PLAN_LIMIT_EXCEEDED` error code so callers (the transactional
 * enforcement and the web app) react consistently.
 */
export type NumericLimitDecision =
  | { readonly allow: true }
  | { readonly allow: false; readonly code: typeof ERROR_CODES.PLAN_LIMIT_EXCEEDED };

/**
 * Pure numeric-limit decision (the in-memory enforcement model).
 *
 * Decision rule (Property 1): ALLOW when the limit is `null` (unlimited) or the
 * usage is strictly below the limit; REJECT with `PLAN_LIMIT_EXCEEDED` when the
 * limit is a number and `usage >= limit`.
 *
 * Exported as a free function so it can be exercised in isolation by property
 * tests and reused unchanged by the transactional `assertWithinNumericLimit`.
 */
export function decideNumericLimit(limit: number | null, usage: number): NumericLimitDecision {
  if (limit === null || usage < limit) {
    return { allow: true };
  }
  return { allow: false, code: ERROR_CODES.PLAN_LIMIT_EXCEEDED };
}

/**
 * Central plan-enforcement policy service: the single source of truth that maps
 * an organization's plan to its `PLAN_LIMITS` entry and performs both kinds of
 * enforcement (numeric limits and feature flags).
 *
 * This task implements only the pure, synchronous policy methods. The async,
 * transactional enforcement methods (`assertWithinNumericLimit`,
 * `assertWithinDailyQueueLimit`, `getPlanUsage`) are added to this same class in
 * later tasks, which is why `PrismaService` is injected now even though the
 * methods below do not use it.
 */
@Injectable()
export class PlanLimitsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Resolve a plan to its limits object (pure). The entry is the static
   * `PLAN_LIMITS` record for the plan and is the basis for every enforcement
   * decision.
   */
  limitsFor(plan: PlanType): PlanLimits {
    return PLAN_LIMITS[plan];
  }

  /**
   * Pure feature decision used by the feature guard and the plan-usage endpoint.
   * Permits a surface if and only if the resolved plan enables the flag (R3.1,
   * R3.2, R4.1, R4.2).
   */
  isFeatureEnabled(plan: PlanType, flag: FeatureFlag): boolean {
    return this.limitsFor(plan)[flag];
  }

  /**
   * Resolve the governing numeric limit for a resource on a plan (pure). Reused
   * by the transactional enforcement to know which field to check and the value
   * to compare usage against (`null` ⇒ unlimited, R1.4).
   */
  numericLimitFor(plan: PlanType, resource: NumericResource): ResolvedNumericLimit {
    const limitName = RESOURCE_TO_LIMIT_NAME[resource];
    return { limitName, limit: this.limitsFor(plan)[limitName] };
  }

  /**
   * Atomic numeric-limit guard for a create. MUST be called inside an existing
   * Prisma transaction `tx` so the usage count and the subsequent `tx.create`
   * form one atomic unit (R1.6) — concurrent creates cannot both pass the check
   * and overshoot the limit under `Serializable` isolation.
   *
   * Behaviour (Property 1 / Property 2):
   * - Loads the org plan; throws {@link OrgNotFoundException} when the org is
   *   unknown (R3.4-style guard for the create path).
   * - Resolves the governing numeric limit; returns immediately when it is
   *   `null` (unlimited, R1.4).
   * - Counts the current usage of `resource` within `tx` (measured at the moment
   *   of the attempt, R1.1) and throws {@link PlanLimitExceededException} with
   *   numeric `details` when `usage >= limit` (R1.2 / R5.2). On rejection the
   *   caller never reaches `tx.create`, so usage is left unchanged (R1.3).
   *
   * Intended for the `services`, `counters`, and `staff` resources; daily queue
   * volume has its own windowed variant ({@link assertWithinDailyQueueLimit}).
   */
  async assertWithinNumericLimit(
    tx: Prisma.TransactionClient,
    orgId: string,
    resource: NumericResource,
  ): Promise<void> {
    const org = await tx.organization.findUnique({
      where: { id: orgId },
      select: { plan: true },
    });
    if (!org) {
      throw new OrgNotFoundException();
    }

    // Bridge Prisma's generated plan union to the shared-types `PlanType` enum
    // (same string values, distinct nominal types across package boundaries).
    const plan = org.plan as PlanType;
    const { limitName, limit } = this.numericLimitFor(plan, resource);
    if (limit === null) {
      return; // R1.4 — unlimited.
    }

    const currentUsage = await this.countResourceUsage(tx, orgId, resource);
    const decision = decideNumericLimit(limit, currentUsage);
    if (!decision.allow) {
      throw new PlanLimitExceededException({ limitName, limit, currentUsage, plan });
    }
  }

  /**
   * Atomic daily-queue-volume guard (R2). MUST be called inside `joinQueue`'s
   * transaction so the volume check and the ticket create stay atomic.
   *
   * Resolves the org-timezone reset-time window via {@link resolveDailyWindow}
   * (reading `Organization.timezone` and `QueueSettings.resetTime`, defaulting to
   * {@link QUEUE_DEFAULTS.RESET_TIME}), sums the monotonic, deletion-proof
   * `DailyQueueCounter.lastNumber` for the window date as the authoritative
   * Daily_Queue_Volume (counts creations regardless of later state changes,
   * R2.5), and applies the same `>=` rejection rule as numeric limits. Returns
   * immediately when `maxQueuePerDay` is `null` (unlimited, R2.3).
   */
  async assertWithinDailyQueueLimit(tx: Prisma.TransactionClient, orgId: string): Promise<void> {
    const org = await tx.organization.findUnique({
      where: { id: orgId },
      select: { plan: true, timezone: true, settings: { select: { resetTime: true } } },
    });
    if (!org) {
      throw new OrgNotFoundException();
    }

    const plan = org.plan as PlanType;
    const { limitName, limit } = this.numericLimitFor(plan, 'queuePerDay');
    if (limit === null) {
      return; // R2.3 — unlimited.
    }

    const currentUsage = await this.countDailyQueueVolume(
      tx,
      orgId,
      org.timezone,
      org.settings?.resetTime,
    );
    const decision = decideNumericLimit(limit, currentUsage);
    if (!decision.allow) {
      throw new PlanLimitExceededException({ limitName, limit, currentUsage, plan });
    }
  }

  /**
   * Build the plan-usage projection consumed by the web app's Plan & Usage view
   * (R8). Runs outside any transaction, so it reads through the injected
   * {@link PrismaService} directly.
   *
   * Resolves the org's plan (throwing {@link OrgNotFoundException} for an unknown
   * org), projects every {@link FeatureFlag} into the `features` record (mirrors
   * the feature gating of R9), and projects every {@link NumericResource} into a
   * `resources` entry using the same counting logic as the transactional
   * enforcement ({@link countResourceUsage} / {@link countDailyQueueVolume}) and
   * the same daily-window helper. For each resource `atLimit` is
   * `limit !== null && usage >= limit`, so an unlimited (`null`) limit always
   * yields `atLimit === false` (R8.3, R8.4).
   */
  async getPlanUsage(orgId: string): Promise<PlanUsageResponse> {
    const org = await this.prisma.organization.findUnique({
      where: { id: orgId },
      select: { plan: true, timezone: true, settings: { select: { resetTime: true } } },
    });
    if (!org) {
      throw new OrgNotFoundException();
    }

    // Bridge Prisma's generated plan union to the shared-types `PlanType` enum.
    const plan = org.plan as PlanType;

    const features: Record<FeatureFlag, boolean> = {
      tvDisplay: this.isFeatureEnabled(plan, 'tvDisplay'),
      analytics: this.isFeatureEnabled(plan, 'analytics'),
      customBranding: this.isFeatureEnabled(plan, 'customBranding'),
    };

    const resourceKeys: readonly NumericResource[] = [
      'services',
      'counters',
      'staff',
      'queuePerDay',
    ];
    const resources: PlanUsageResource[] = await Promise.all(
      resourceKeys.map(async (resource): Promise<PlanUsageResource> => {
        const { limitName, limit } = this.numericLimitFor(plan, resource);
        const usage =
          resource === 'queuePerDay'
            ? await this.countDailyQueueVolume(
                this.prisma,
                orgId,
                org.timezone,
                org.settings?.resetTime,
              )
            : await this.countResourceUsage(this.prisma, orgId, resource);
        const atLimit = limit !== null && usage >= limit;
        return { resource, limitName, usage, limit, atLimit };
      }),
    );

    return { plan, features, resources };
  }

  /**
   * Count the current usage of a numeric resource within `tx`, measured at the
   * moment of the attempt (R1.1). For `staff` the count is existing `UserRole`
   * members **plus** `PENDING` invitations, so an invite that will become a
   * member cannot bypass `maxStaff`.
   */
  private async countResourceUsage(
    tx: Prisma.TransactionClient | PrismaService,
    orgId: string,
    resource: NumericResource,
  ): Promise<number> {
    switch (resource) {
      case 'services':
        return tx.service.count({ where: { orgId } });
      case 'counters':
        return tx.counter.count({ where: { orgId } });
      case 'staff': {
        const [members, pendingInvitations] = await Promise.all([
          tx.userRole.count({ where: { orgId } }),
          tx.invitation.count({ where: { orgId, status: InvitationStatus.PENDING } }),
        ]);
        return members + pendingInvitations;
      }
      case 'queuePerDay':
        return this.countDailyQueueVolume(tx, orgId);
    }
  }

  /**
   * Sum the monotonic per-service `DailyQueueCounter.lastNumber` for the org's
   * current daily window date. `lastNumber` is incremented on every join and
   * never decremented, so this is the deletion-proof Daily_Queue_Volume (R2.5).
   */
  private async countDailyQueueVolume(
    tx: Prisma.TransactionClient | PrismaService,
    orgId: string,
    timezone?: string,
    resetTime?: string | null,
  ): Promise<number> {
    let zone = timezone;
    let reset = resetTime;
    if (zone === undefined || reset === undefined) {
      const org = await tx.organization.findUnique({
        where: { id: orgId },
        select: { timezone: true, settings: { select: { resetTime: true } } },
      });
      zone = org?.timezone ?? 'UTC';
      reset = org?.settings?.resetTime;
    }

    const { windowDate } = resolveDailyWindow(zone, reset ?? QUEUE_DEFAULTS.RESET_TIME, new Date());
    const { _sum } = await tx.dailyQueueCounter.aggregate({
      _sum: { lastNumber: true },
      where: { orgId, date: windowDate },
    });
    return _sum.lastNumber ?? 0;
  }
}
