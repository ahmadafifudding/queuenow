import {
  Controller,
  Get,
  Post,
  Body,
  UseGuards,
  HttpCode,
  HttpStatus,
  Query,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiQuery } from '@nestjs/swagger';
import { NotificationService } from './notification.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RegisterPushTokenDto } from './dto';

@ApiTags('Notifications')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('notifications')
export class NotificationController {
  constructor(private readonly notificationService: NotificationService) {}

  @Post('push-token')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Register or update push notification token' })
  async registerPushToken(@CurrentUser() user: any, @Body() dto: RegisterPushTokenDto) {
    return this.notificationService.registerPushToken(user.sub, dto);
  }

  @Get()
  @ApiOperation({ summary: 'Get notifications for current customer' })
  @ApiQuery({ name: 'limit', required: false, description: 'Number of notifications to return' })
  @ApiQuery({ name: 'offset', required: false, description: 'Offset for pagination' })
  async getNotifications(
    @CurrentUser() user: any,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    return this.notificationService.getNotifications(
      user.sub,
      limit ? parseInt(limit, 10) : 20,
      offset ? parseInt(offset, 10) : 0,
    );
  }
}
