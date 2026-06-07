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
import { CounterService } from './counter.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

@ApiTags('Counters')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('organizations/:orgId/counters')
export class CounterController {
  constructor(private readonly counterService: CounterService) {}

  @Post()
  @Roles('OWNER', 'ADMIN')
  @ApiOperation({ summary: 'Create a new counter' })
  @ApiParam({ name: 'orgId', description: 'Organization ID' })
  async create(
    @Param('orgId') orgId: string,
    @Body() dto: any,
    @CurrentUser() user: any,
  ) {
    return this.counterService.create(orgId, dto, user);
  }

  @Get()
  @Roles('OWNER', 'ADMIN', 'STAFF')
  @ApiOperation({ summary: 'List all counters for organization' })
  @ApiParam({ name: 'orgId', description: 'Organization ID' })
  async findAll(@Param('orgId') orgId: string, @CurrentUser() user: any) {
    return this.counterService.findAll(orgId, user);
  }

  @Get(':id')
  @Roles('OWNER', 'ADMIN', 'STAFF')
  @ApiOperation({ summary: 'Get counter by ID' })
  @ApiParam({ name: 'orgId', description: 'Organization ID' })
  @ApiParam({ name: 'id', description: 'Counter ID' })
  async findOne(
    @Param('orgId') orgId: string,
    @Param('id') id: string,
    @CurrentUser() user: any,
  ) {
    return this.counterService.findOne(orgId, id, user);
  }

  @Patch(':id')
  @Roles('OWNER', 'ADMIN')
  @ApiOperation({ summary: 'Update a counter' })
  @ApiParam({ name: 'orgId', description: 'Organization ID' })
  @ApiParam({ name: 'id', description: 'Counter ID' })
  async update(
    @Param('orgId') orgId: string,
    @Param('id') id: string,
    @Body() dto: any,
    @CurrentUser() user: any,
  ) {
    return this.counterService.update(orgId, id, dto, user);
  }

  @Delete(':id')
  @Roles('OWNER', 'ADMIN')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a counter' })
  @ApiParam({ name: 'orgId', description: 'Organization ID' })
  @ApiParam({ name: 'id', description: 'Counter ID' })
  async remove(
    @Param('orgId') orgId: string,
    @Param('id') id: string,
    @CurrentUser() user: any,
  ) {
    return this.counterService.remove(orgId, id, user);
  }
}
