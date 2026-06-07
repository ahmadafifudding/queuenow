import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiParam, ApiQuery } from '@nestjs/swagger';
import { DisplayService } from './display.service';
import { Public } from '../../common/decorators/public.decorator';

@ApiTags('Display')
@Controller('organizations/:orgId/display')
export class DisplayController {
  constructor(private readonly displayService: DisplayService) {}

  @Public()
  @Get()
  @ApiOperation({ summary: 'Get display data for queue screens (public, no auth)' })
  @ApiParam({ name: 'orgId', description: 'Organization ID' })
  @ApiQuery({ name: 'serviceId', required: false, description: 'Filter by service ID' })
  async getDisplayData(
    @Param('orgId') orgId: string,
    @Query('serviceId') serviceId?: string,
  ) {
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
