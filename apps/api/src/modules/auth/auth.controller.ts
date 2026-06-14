import {
  Controller,
  Get,
  Post,
  Body,
  HttpCode,
  HttpStatus,
  Res,
  Req,
  UseGuards,
  UnauthorizedException,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { ConfigService } from '@nestjs/config';
import { Request, Response } from 'express';
import type { ILoginResponse, OrganizationMembership } from '@queuenow/shared-types';
import { AuthService } from './auth.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { SwitchOrganizationDto } from './dto/switch-organization.dto';
import { Public } from '../../common/decorators/public.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { IAuthenticatedUser } from '../../common/interfaces';

const REFRESH_COOKIE_NAME = 'refresh_token';
const REFRESH_TOKEN_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

@ApiTags('Auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly configService: ConfigService,
  ) {}

  @Public()
  @Post('register')
  @ApiOperation({ summary: 'Register new owner with organization' })
  @ApiResponse({ status: 201, description: 'Registration successful' })
  async register(@Body() dto: RegisterDto, @Res({ passthrough: true }) res: Response) {
    const result = await this.authService.register(dto);
    return this.respondWithRefreshCookie(res, result);
  }

  @Public()
  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Login with email and password' })
  @ApiResponse({ status: 200, description: 'Login successful' })
  async login(@Body() dto: LoginDto, @Res({ passthrough: true }) res: Response) {
    const result = await this.authService.login(dto);
    return this.respondWithRefreshCookie(res, result);
  }

  @Public()
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Refresh access token using the httpOnly refresh cookie' })
  async refresh(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const refreshToken = this.extractRefreshToken(req);
    const result = await this.authService.refreshToken(refreshToken);
    return this.respondWithRefreshCookie(res, result);
  }

  @Post('logout')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Logout and revoke the refresh token' })
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const refreshToken = req.cookies?.[REFRESH_COOKIE_NAME] as string | undefined;
    if (refreshToken) {
      await this.authService.logout(refreshToken);
    }
    res.clearCookie(REFRESH_COOKIE_NAME, this.cookieOptions());
    return { message: 'Logged out successfully' };
  }

  @Get('organizations')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: "List the current user's organization memberships" })
  @ApiResponse({ status: 200, description: 'Organization memberships returned' })
  async listOrganizations(
    @CurrentUser() user: IAuthenticatedUser,
  ): Promise<OrganizationMembership[]> {
    return this.authService.listOrganizations(user.id, user.orgId);
  }

  @Post('switch-organization')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Switch the active organization and re-issue tokens' })
  @ApiResponse({ status: 200, description: 'Organization switched successfully' })
  async switchOrganization(
    @CurrentUser() user: IAuthenticatedUser,
    @Body() dto: SwitchOrganizationDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<Omit<ILoginResponse, 'tokens'> & { tokens: { accessToken: string } }> {
    const presentedRefreshToken = this.extractRefreshToken(req);
    const result = await this.authService.switchOrganization(
      user.id,
      dto.orgId,
      presentedRefreshToken,
    );
    return this.respondWithRefreshCookie(res, result);
  }

  /**
   * Reads the refresh token from the httpOnly cookie, rejecting requests that
   * do not carry one (the token is never accepted from the request body).
   */
  private extractRefreshToken(req: Request): string {
    const refreshToken = req.cookies?.[REFRESH_COOKIE_NAME] as string | undefined;
    if (!refreshToken) {
      throw new UnauthorizedException('Missing refresh token');
    }
    return refreshToken;
  }

  /**
   * Sets the refresh token as an httpOnly cookie and strips it from the JSON
   * response body so it is never exposed to client-side JavaScript.
   */
  private respondWithRefreshCookie<
    T extends { tokens: { accessToken: string; refreshToken: string } },
  >(res: Response, result: T): Omit<T, 'tokens'> & { tokens: { accessToken: string } } {
    const { refreshToken, accessToken } = result.tokens;

    res.cookie(REFRESH_COOKIE_NAME, refreshToken, {
      ...this.cookieOptions(),
      maxAge: REFRESH_TOKEN_MAX_AGE_MS,
    });

    return { ...result, tokens: { accessToken } };
  }

  /**
   * Shared cookie attributes. `secure` is enabled outside development so the
   * cookie is only sent over HTTPS in staging/production.
   */
  private cookieOptions() {
    const isProduction = this.configService.get<string>('NODE_ENV') === 'production';
    const apiPrefix = this.configService.get<string>('API_PREFIX', 'api/v1');

    return {
      httpOnly: true,
      secure: isProduction,
      sameSite: 'lax' as const,
      path: `/${apiPrefix}/auth`,
    };
  }
}
