import { Global, Module } from '@nestjs/common';

import { PlanLimitsService } from './plan-limits.service';

/**
 * Central plan-enforcement module. Registered as `@Global()` (like
 * `PrismaModule`) so any feature module — Service/Counter/Staff/Queue create
 * flows, the feature guard, and the organization plan-usage endpoint — can
 * inject {@link PlanLimitsService} without re-importing this module.
 */
@Global()
@Module({
  providers: [PlanLimitsService],
  exports: [PlanLimitsService],
})
export class PlanModule {}
