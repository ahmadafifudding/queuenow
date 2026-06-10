import {
  Controller,
  Get,
  Post,
  Delete,
  Param,
  Body,
  UseGuards,
  HttpCode,
  HttpStatus,
  Query,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiParam, ApiQuery } from '@nestjs/swagger';
import { StaffService } from './staff.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { InviteStaffDto } from './dto';
import { IAuthenticatedUser } from '../../common/interfaces';

@ApiTags('Staff')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('organizations/:orgId/staff')
export class StaffController {
  constructor(private readonly staffService: StaffService) {}

  @Post('invite')
  @Roles('OWNER', 'ADMIN')
  @ApiOperation({ summary: 'Invite a staff member to the organization' })
  @ApiParam({ name: 'orgId', description: 'Organization ID' })
  async invite(
    @Param('orgId') orgId: string,
    @Body() dto: InviteStaffDto,
    @CurrentUser() user: IAuthenticatedUser,
  ) {
    return this.staffService.invite(orgId, dto, user);
  }

  @Get()
  @Roles('OWNER', 'ADMIN')
  @ApiOperation({ summary: 'List all staff members' })
  @ApiParam({ name: 'orgId', description: 'Organization ID' })
  @ApiQuery({ name: 'role', required: false, description: 'Filter by role' })
  async findAll(
    @Param('orgId') orgId: string,
    @Query('role') role: string | undefined,
    @CurrentUser() user: IAuthenticatedUser,
  ) {
    return this.staffService.findAll(orgId, role, user);
  }

  @Get('invitations')
  @Roles('OWNER', 'ADMIN')
  @ApiOperation({ summary: 'List pending invitations' })
  @ApiParam({ name: 'orgId', description: 'Organization ID' })
  async listInvitations(@Param('orgId') orgId: string, @CurrentUser() user: IAuthenticatedUser) {
    return this.staffService.listInvitations(orgId, user);
  }

  @Delete(':userId')
  @Roles('OWNER', 'ADMIN')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Remove a staff member from the organization' })
  @ApiParam({ name: 'orgId', description: 'Organization ID' })
  @ApiParam({ name: 'userId', description: 'User ID to remove' })
  async remove(
    @Param('orgId') orgId: string,
    @Param('userId') userId: string,
    @CurrentUser() user: IAuthenticatedUser,
  ) {
    return this.staffService.remove(orgId, userId, user);
  }

  @Delete('invitations/:invitationId')
  @Roles('OWNER', 'ADMIN')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Cancel a pending invitation' })
  @ApiParam({ name: 'orgId', description: 'Organization ID' })
  @ApiParam({ name: 'invitationId', description: 'Invitation ID' })
  async cancelInvitation(
    @Param('orgId') orgId: string,
    @Param('invitationId') invitationId: string,
    @CurrentUser() user: IAuthenticatedUser,
  ) {
    return this.staffService.cancelInvitation(orgId, invitationId, user);
  }
}
