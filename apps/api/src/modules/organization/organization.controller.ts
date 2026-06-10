import { Controller, Get, Patch, Param, Body, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiParam } from '@nestjs/swagger';
import { OrganizationService } from './organization.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { UpdateOrganizationDto, UpdateBrandingDto, UpdateSettingsDto } from './dto';
import { IAuthenticatedUser } from '../../common/interfaces';

@ApiTags('Organizations')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('organizations')
export class OrganizationController {
  constructor(private readonly organizationService: OrganizationService) {}

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
  @ApiOperation({ summary: 'Get organization statistics for today' })
  @ApiParam({ name: 'id', description: 'Organization ID' })
  async getStats(@Param('id') id: string, @CurrentUser() user: IAuthenticatedUser) {
    return this.organizationService.getStats(id, user.orgId);
  }
}
