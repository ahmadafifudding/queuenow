import {
  Controller,
  Get,
  Post,
  Param,
  Body,
  UseGuards,
  HttpCode,
  HttpStatus,
  Query,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiParam, ApiQuery } from '@nestjs/swagger';
import { QueueService } from './queue.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { JoinQueueDto, CallNextDto } from './dto';
import { IAuthenticatedUser } from '../../common/interfaces';

@ApiTags('Queue')
@Controller('organizations/:orgId/queue')
export class QueueController {
  constructor(private readonly queueService: QueueService) {}

  @Public()
  @Post('join')
  @ApiOperation({ summary: 'Join the queue (public - no auth required)' })
  @ApiParam({ name: 'orgId', description: 'Organization ID' })
  async joinQueue(@Param('orgId') orgId: string, @Body() dto: JoinQueueDto) {
    return this.queueService.joinQueue(orgId, dto);
  }

  @Post('call-next')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('OWNER', 'ADMIN', 'STAFF')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Call next customer in queue (FIFO)' })
  @ApiParam({ name: 'orgId', description: 'Organization ID' })
  async callNext(
    @Param('orgId') orgId: string,
    @Body() dto: CallNextDto,
    @CurrentUser() user: IAuthenticatedUser,
  ) {
    return this.queueService.callNext(orgId, dto, user);
  }

  @Post(':ticketId/recall')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('OWNER', 'ADMIN', 'STAFF')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Recall a customer (max 2 times)' })
  @ApiParam({ name: 'orgId', description: 'Organization ID' })
  @ApiParam({ name: 'ticketId', description: 'Ticket ID' })
  async recall(
    @Param('orgId') orgId: string,
    @Param('ticketId') ticketId: string,
    @CurrentUser() user: IAuthenticatedUser,
  ) {
    return this.queueService.recall(orgId, ticketId, user);
  }

  @Post(':ticketId/skip')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('OWNER', 'ADMIN', 'STAFF')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Skip a called customer' })
  @ApiParam({ name: 'orgId', description: 'Organization ID' })
  @ApiParam({ name: 'ticketId', description: 'Ticket ID' })
  async skip(
    @Param('orgId') orgId: string,
    @Param('ticketId') ticketId: string,
    @CurrentUser() user: IAuthenticatedUser,
  ) {
    return this.queueService.skip(orgId, ticketId, user);
  }

  @Post(':ticketId/complete')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('OWNER', 'ADMIN', 'STAFF')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Complete serving a customer' })
  @ApiParam({ name: 'orgId', description: 'Organization ID' })
  @ApiParam({ name: 'ticketId', description: 'Ticket ID' })
  async complete(
    @Param('orgId') orgId: string,
    @Param('ticketId') ticketId: string,
    @CurrentUser() user: IAuthenticatedUser,
  ) {
    return this.queueService.complete(orgId, ticketId, user);
  }

  @Post(':ticketId/rejoin')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('OWNER', 'ADMIN', 'STAFF')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Rejoin a skipped customer back into the queue' })
  @ApiParam({ name: 'orgId', description: 'Organization ID' })
  @ApiParam({ name: 'ticketId', description: 'Ticket ID' })
  async rejoin(
    @Param('orgId') orgId: string,
    @Param('ticketId') ticketId: string,
    @CurrentUser() user: IAuthenticatedUser,
  ) {
    return this.queueService.rejoin(orgId, ticketId, user);
  }

  @Public()
  @Get('status')
  @ApiOperation({ summary: 'Get current queue status (public)' })
  @ApiParam({ name: 'orgId', description: 'Organization ID' })
  @ApiQuery({ name: 'serviceId', required: false, description: 'Filter by service' })
  async getCurrentStatus(
    @Param('orgId') orgId: string,
    @Query('serviceId') serviceId?: string,
  ) {
    return this.queueService.getCurrentStatus(orgId, serviceId);
  }

  @Public()
  @Get('ticket/:ticketId')
  @ApiOperation({ summary: 'Get ticket status by ID (public - for customer tracking)' })
  @ApiParam({ name: 'orgId', description: 'Organization ID' })
  @ApiParam({ name: 'ticketId', description: 'Ticket ID' })
  async getTicketStatus(
    @Param('orgId') orgId: string,
    @Param('ticketId') ticketId: string,
  ) {
    return this.queueService.getTicketStatus(orgId, ticketId);
  }
}
