import { Controller, Get, Patch, Param, Body, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { OrganizationService } from './organization.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

@ApiTags('Organizations')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('organizations')
export class OrganizationController {
  constructor(private readonly organizationService: OrganizationService) {}

  @Get(':id')
  @Roles('OWNER', 'ADMIN')
  @ApiOperation({ summary: 'Get organization details' })
  async findOne(@Param('id') id: string, @CurrentUser() user: any) {
    return this.organizationService.findOne(id, user.orgId);
  }

  @Patch(':id')
  @Roles('OWNER', 'ADMIN')
  @ApiOperation({ summary: 'Update organization' })
  async update(@Param('id') id: string, @Body() dto: any, @CurrentUser() user: any) {
    return this.organizationService.update(id, dto, user.orgId);
  }

  @Get(':id/stats')
  @Roles('OWNER', 'ADMIN')
  @ApiOperation({ summary: 'Get organization statistics' })
  async getStats(@Param('id') id: string, @CurrentUser() user: any) {
    return this.organizationService.getStats(id, user.orgId);
  }
}
