import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { FeatureFlag, PlanType } from '@queuenow/shared-types';

import { PlanLimitsService } from '../../modules/plan/plan-limits.service';
import { PrismaService } from '../../prisma/prisma.service';
import { REQUIRES_FEATURE_KEY } from '../decorators/requires-feature.decorator';
import { OrgNotFoundException } from '../exceptions/org-not-found.exception';
import { PlanLimitExceededException } from '../exceptions/plan-limit-exceeded.exception';

/**
 * The minimal request shape the guard needs to resolve an organization context.
 * `orgId` may come from a public route parameter (TV Display, R3.3) or from the
 * authenticated user's JWT claims (Analytics, R4).
 */
interface FeatureGuardRequest {
  params?: { orgId?: string };
  user?: { orgId?: string };
}

/**
 * Declarative feature-gate guard (R3, R4). Reads the {@link RequiresFeature}
 * metadata and, when present, permits the request if and only if the resolved
 * organization's plan enables the flag.
 *
 * Decision order matters: the organization context is resolved and validated
 * **before** the feature check, so an unknown/absent org always yields
 * `ORG_NOT_FOUND` and takes precedence over `PLAN_LIMIT_EXCEEDED` (R3.4).
 */
@Injectable()
export class PlanFeatureGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly planLimits: PlanLimitsService,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const flag = this.reflector.getAllAndOverride<FeatureFlag | undefined>(REQUIRES_FEATURE_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    // No feature requirement on this route ⇒ nothing to enforce.
    if (!flag) {
      return true;
    }

    const request = context.switchToHttp().getRequest<FeatureGuardRequest>();
    // R3.3: identical evaluation for public (param) and authenticated (JWT)
    // requests — the only difference is where `orgId` is sourced from.
    const orgId = request.params?.orgId ?? request.user?.orgId;
    if (!orgId) {
      throw new OrgNotFoundException();
    }

    const org = await this.prisma.organization.findUnique({
      where: { id: orgId },
      select: { plan: true },
    });
    // R3.4: unknown org is decided before the feature check.
    if (!org) {
      throw new OrgNotFoundException();
    }

    // Bridge Prisma's generated plan union to the shared-types `PlanType` enum
    // (same string values, distinct nominal types across package boundaries).
    const plan = org.plan as PlanType;
    if (!this.planLimits.isFeatureEnabled(plan, flag)) {
      throw new PlanLimitExceededException({ flag, plan }); // R3.1 / R4.1
    }

    return true;
  }
}
