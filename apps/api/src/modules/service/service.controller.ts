import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Body,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiParam } from '@nestjs/swagger';
import { ServiceService } from './service.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

@ApiTags('Services')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('organizations/:orgId/services')
export class ServiceController {
  constructor(private readonly serviceService: ServiceService) {}

  @Post()
  @Roles('OWNER', 'ADMIN')
  @ApiOperation({ summary: 'Create a new service' })
  @ApiParam({ name: 'orgId', description: 'Organization ID' })
  async create(
    @Param('orgId') orgId: string,
    @Body() dto: any,
    @CurrentUser() user: any,
  ) {
    return this.serviceService.create(orgId, dto, user);
  }

  @Get()
  @Roles('OWNER', 'ADMIN', 'STAFF')
  @ApiOperation({ summary: 'List all services for organization' })
  @ApiParam({ name: 'orgId', description: 'Organization ID' })
  async findAll(@Param('orgId') orgId: string, @CurrentUser() user: any) {
    return this.serviceService.findAll(orgId, user);
  }

  @Get(':id')
  @Roles('OWNER', 'ADMIN', 'STAFF')
  @ApiOperation({ summary: 'Get service by ID' })
  @ApiParam({ name: 'orgId', description: 'Organization ID' })
  @ApiParam({ name: 'id', description: 'Service ID' })
  async findOne(
    @Param('orgId') orgId: string,
    @Param('id') id: string,
    @CurrentUser() user: any,
  ) {
    return this.serviceService.findOne(orgId, id, user);
  }

  @Patch(':id')
  @Roles('OWNER', 'ADMIN')
  @ApiOperation({ summary: 'Update a service' })
  @ApiParam({ name: 'orgId', description: 'Organization ID' })
  @ApiParam({ name: 'id', description: 'Service ID' })
  async update(
    @Param('orgId') orgId: string,
    @Param('id') id: string,
    @Body() dto: any,
    @CurrentUser() user: any,
  ) {
    return this.serviceService.update(orgId, id, dto, user);
  }

  @Delete(':id')
  @Roles('OWNER', 'ADMIN')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a service' })
  @ApiParam({ name: 'orgId', description: 'Organization ID' })
  @ApiParam({ name: 'id', description: 'Service ID' })
  async remove(
    @Param('orgId') orgId: string,
    @Param('id') id: string,
    @CurrentUser() user: any,
  ) {
    return this.serviceService.remove(orgId, id, user);
  }
}
