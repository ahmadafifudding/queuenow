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
import { RegisterCustomerDto, LoginCustomerDto, UpdateProfileDto } from './dto';
import { IAuthenticatedCustomer } from '../../common/interfaces';

@ApiTags('Customers')
@Controller('customers')
export class CustomerController {
  constructor(private readonly customerService: CustomerService) {}

  @Public()
  @Post('register')
  @ApiOperation({ summary: 'Register a new customer account' })
  async register(@Body() dto: RegisterCustomerDto) {
    return this.customerService.register(dto);
  }

  @Public()
  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Customer login with email/phone and password' })
  async login(@Body() dto: LoginCustomerDto) {
    return this.customerService.login(dto);
  }

  @Get('profile')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Get customer profile' })
  async getProfile(@CurrentUser() user: IAuthenticatedCustomer) {
    return this.customerService.getProfile(user.id);
  }

  @Patch('profile')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Update customer profile' })
  async updateProfile(@CurrentUser() user: IAuthenticatedCustomer, @Body() dto: UpdateProfileDto) {
    return this.customerService.updateProfile(user.id, dto);
  }

  @Get('history')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Get customer queue history' })
  async getHistory(@CurrentUser() user: IAuthenticatedCustomer) {
    return this.customerService.getHistory(user.id);
  }

  @Get('favorites')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Get customer favorite organizations' })
  async getFavorites(@CurrentUser() user: IAuthenticatedCustomer) {
    return this.customerService.getFavorites(user.id);
  }

  @Post('favorites/:orgId')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Add organization to favorites' })
  async addFavorite(@CurrentUser() user: IAuthenticatedCustomer, @Param('orgId') orgId: string) {
    return this.customerService.addFavorite(user.id, orgId);
  }

  @Delete('favorites/:orgId')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Remove organization from favorites' })
  async removeFavorite(@CurrentUser() user: IAuthenticatedCustomer, @Param('orgId') orgId: string) {
    return this.customerService.removeFavorite(user.id, orgId);
  }
}
