import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiParam } from '@nestjs/swagger';
import { QrCodeService } from './qr-code.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { IAuthenticatedUser } from '../../common/interfaces';

@ApiTags('QR Code')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('organizations/:orgId/qr-code')
export class QrCodeController {
  constructor(private readonly qrCodeService: QrCodeService) {}

  @Get()
  @Roles('OWNER', 'ADMIN')
  @ApiOperation({ summary: 'Generate QR code URL for the organization queue' })
  @ApiParam({ name: 'orgId', description: 'Organization ID' })
  async generateOrgQrCode(
    @Param('orgId') orgId: string,
    @CurrentUser() user: IAuthenticatedUser,
  ) {
    return this.qrCodeService.generateOrgQrUrl(orgId, user);
  }

  @Get('services/:serviceId')
  @Roles('OWNER', 'ADMIN')
  @ApiOperation({ summary: 'Generate QR code URL for a specific service' })
  @ApiParam({ name: 'orgId', description: 'Organization ID' })
  @ApiParam({ name: 'serviceId', description: 'Service ID' })
  async generateServiceQrCode(
    @Param('orgId') orgId: string,
    @Param('serviceId') serviceId: string,
    @CurrentUser() user: IAuthenticatedUser,
  ) {
    return this.qrCodeService.generateServiceQrUrl(orgId, serviceId, user);
  }
}
