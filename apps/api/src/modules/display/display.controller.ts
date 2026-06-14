import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiParam, ApiQuery } from '@nestjs/swagger';
import { DisplayService } from './display.service';
import { Public } from '../../common/decorators/public.decorator';
import { RequiresFeature } from '../../common/decorators/requires-feature.decorator';
import { PlanFeatureGuard } from '../../common/guards/plan-feature.guard';

/**
 * Public TV Display surface, feature-gated by the organization's plan (R3).
 *
 * The controller stays `@Public()` (no JWT required, R3.3); `PlanFeatureGuard`
 * resolves `orgId` from the `:orgId` route param and enforces the `tvDisplay`
 * flag. An unknown org yields `ORG_NOT_FOUND` (R3.4) before the feature check,
 * and a plan without `tvDisplay` yields `PLAN_LIMIT_EXCEEDED` (R3.1).
 */
@ApiTags('Display')
@UseGuards(PlanFeatureGuard)
@RequiresFeature('tvDisplay')
@Controller('organizations/:orgId/display')
export class DisplayController {
  constructor(private readonly displayService: DisplayService) {}

  @Public()
  @Get()
  @ApiOperation({ summary: 'Get display data for queue screens (public, no auth)' })
  @ApiParam({ name: 'orgId', description: 'Organization ID' })
  @ApiQuery({ name: 'serviceId', required: false, description: 'Filter by service ID' })
  async getDisplayData(@Param('orgId') orgId: string, @Query('serviceId') serviceId?: string) {
    return this.displayService.getDisplayData(orgId, serviceId);
  }

  @Public()
  @Get('now-serving')
  @ApiOperation({ summary: 'Get currently serving tickets for display' })
  @ApiParam({ name: 'orgId', description: 'Organization ID' })
  async getNowServing(@Param('orgId') orgId: string) {
    return this.displayService.getNowServing(orgId);
  }

  @Public()
  @Get('branding')
  @ApiOperation({ summary: 'Get organization branding for display customization' })
  @ApiParam({ name: 'orgId', description: 'Organization ID' })
  async getBranding(@Param('orgId') orgId: string) {
    return this.displayService.getBranding(orgId);
  }
}
