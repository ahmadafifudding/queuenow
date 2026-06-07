import {
  Controller,
  Get,
  Post,
  Patch,
  Param,
  Body,
  UseGuards,
  HttpCode,
  HttpStatus,
  Delete,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { CustomerService } from './customer.service';
import { Public } from '../../common/decorators/public.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

@ApiTags('Customers')
@Controller('customers')
export class CustomerController {
  constructor(private readonly customerService: CustomerService) {}

  @Public()
  @Post('register')
  @ApiOperation({ summary: 'Register a new customer account' })
  async register(@Body() dto: any) {
    return this.customerService.register(dto);
  }

  @Public()
  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Customer login with email/phone and password' })
  async login(@Body() dto: any) {
    return this.customerService.login(dto);
  }

  @Get('profile')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Get customer profile' })
  async getProfile(@CurrentUser() user: any) {
    return this.customerService.getProfile(user.sub);
  }

  @Patch('profile')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Update customer profile' })
  async updateProfile(@CurrentUser() user: any, @Body() dto: any) {
    return this.customerService.updateProfile(user.sub, dto);
  }

  @Get('history')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Get customer queue history' })
  async getHistory(@CurrentUser() user: any) {
    return this.customerService.getHistory(user.sub);
  }

  @Get('favorites')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Get customer favorite organizations' })
  async getFavorites(@CurrentUser() user: any) {
    return this.customerService.getFavorites(user.sub);
  }

  @Post('favorites/:orgId')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Add organization to favorites' })
  async addFavorite(@CurrentUser() user: any, @Param('orgId') orgId: string) {
    return this.customerService.addFavorite(user.sub, orgId);
  }

  @Delete('favorites/:orgId')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Remove organization from favorites' })
  async removeFavorite(@CurrentUser() user: any, @Param('orgId') orgId: string) {
    return this.customerService.removeFavorite(user.sub, orgId);
  }
}
