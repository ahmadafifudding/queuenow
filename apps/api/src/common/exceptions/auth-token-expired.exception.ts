import { UnauthorizedException } from '@nestjs/common';
import { ERROR_CODES } from '@queuenow/shared-constants';

/**
 * Domain exception thrown when a presented Refresh_Token (or its backing
 * Session) has expired — distinct from a malformed/unknown token, which maps to
 * `AUTH_UNAUTHORIZED`. Raised by `CustomerService.refreshToken()` so the mobile
 * client can clear its stored tokens and route to sign-in (R12.4).
 *
 * Extends NestJS `UnauthorizedException` (HTTP 401) but carries `{ code, message }`
 * on its response object so the shared `HttpExceptionFilter` emits the standard
 * error envelope with `code: AUTH_TOKEN_EXPIRED` instead of the generic `'ERROR'`.
 */
export class AuthTokenExpiredException extends UnauthorizedException {
  constructor(message = 'Refresh token has expired') {
    super({
      code: ERROR_CODES.AUTH_TOKEN_EXPIRED,
      message,
    });
  }
}
