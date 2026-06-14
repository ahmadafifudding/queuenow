import { Controller, Get, Patch, Param, Body, UseGuards, ForbiddenException } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiParam } from '@nestjs/swagger';
import { OrganizationService } from './organization.service';
import { PlanLimitsService } from '../plan/plan-limits.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { PlanFeatureGuard } from '../../common/guards/plan-feature.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { RequiresFeature } from '../../common/decorators/requires-feature.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { UpdateOrganizationDto, UpdateBrandingDto, UpdateSettingsDto, ChangePlanDto } from './dto';
import { IAuthenticatedUser } from '../../common/interfaces';

@ApiTags('Organizations')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('organizations')
export class OrganizationController {
  constructor(
    private readonly organizationService: OrganizationService,
    private readonly planLimitsService: PlanLimitsService,
  ) {}

  @Get(':id')
  @Roles('OWNER', 'ADMIN')
  @ApiOperation({ summary: 'Get organization details' })
  @ApiParam({ name: 'id', description: 'Organization ID' })
  async findOne(@Param('id') id: string, @CurrentUser() user: IAuthenticatedUser) {
    return this.organizationService.findOne(id, user.orgId);
  }

  @Patch(':id')
  @Roles('OWNER', 'ADMIN')
  @ApiOperation({ summary: 'Update organization' })
  @ApiParam({ name: 'id', description: 'Organization ID' })
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateOrganizationDto,
    @CurrentUser() user: IAuthenticatedUser,
  ) {
    return this.organizationService.update(id, dto, user.orgId);
  }

  @Patch(':id/branding')
  @Roles('OWNER', 'ADMIN')
  @ApiOperation({ summary: 'Update organization branding' })
  @ApiParam({ name: 'id', description: 'Organization ID' })
  async updateBranding(
    @Param('id') id: string,
    @Body() dto: UpdateBrandingDto,
    @CurrentUser() user: IAuthenticatedUser,
  ) {
    return this.organizationService.updateBranding(id, dto, user.orgId);
  }

  @Get(':id/settings')
  @Roles('OWNER', 'ADMIN')
  @ApiOperation({ summary: 'Get queue settings' })
  @ApiParam({ name: 'id', description: 'Organization ID' })
  async getSettings(@Param('id') id: string, @CurrentUser() user: IAuthenticatedUser) {
    return this.organizationService.getSettings(id, user.orgId);
  }

  @Patch(':id/settings')
  @Roles('OWNER', 'ADMIN')
  @ApiOperation({ summary: 'Update queue settings' })
  @ApiParam({ name: 'id', description: 'Organization ID' })
  async updateSettings(
    @Param('id') id: string,
    @Body() dto: UpdateSettingsDto,
    @CurrentUser() user: IAuthenticatedUser,
  ) {
    return this.organizationService.updateSettings(id, dto, user.orgId);
  }

  @Get(':id/stats')
  @Roles('OWNER', 'ADMIN')
  @UseGuards(PlanFeatureGuard)
  @RequiresFeature('analytics')
  @ApiOperation({ summary: 'Get organization statistics for today' })
  @ApiParam({ name: 'id', description: 'Organization ID' })
  async getStats(@Param('id') id: string, @CurrentUser() user: IAuthenticatedUser) {
    return this.organizationService.getStats(id, user.orgId);
  }

  @Patch(':id/plan')
  @Roles('OWNER')
  @ApiOperation({ summary: "Change the organization's plan (OWNER only)" })
  @ApiParam({ name: 'id', description: 'Organization ID' })
  async changePlan(
    @Param('id') id: string,
    @Body() dto: ChangePlanDto,
    @CurrentUser() user: IAuthenticatedUser,
  ) {
    return this.organizationService.changePlan(id, dto.plan, user.orgId);
  }

  @Get(':id/plan-usage')
  @Roles('OWNER', 'ADMIN')
  @ApiOperation({ summary: 'Get the organization plan + per-resource usage (R8)' })
  @ApiParam({ name: 'id', description: 'Organization ID' })
  async getPlanUsage(@Param('id') id: string, @CurrentUser() user: IAuthenticatedUser) {
    // Org-scope guard (R8): a user may only read their own org's usage.
    // `PlanLimitsService.getPlanUsage` has no `validateAccess`, so this mirrors
    // `OrganizationService.validateAccess` with an explicit controller check.
    if (id !== user.orgId) {
      throw new ForbiddenException('Access denied to this organization');
    }
    return this.planLimitsService.getPlanUsage(id);
  }
}
