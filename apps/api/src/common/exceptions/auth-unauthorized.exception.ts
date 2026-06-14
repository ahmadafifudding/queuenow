import { UnauthorizedException } from '@nestjs/common';
import { ERROR_CODES } from '@queuenow/shared-constants';

/**
 * Domain exception thrown when a request carries no valid Access_Token (or, for
 * refresh, no/expired Session backing the Refresh_Token). Raised by
 * `JwtAuthGuard`/`JwtStrategy` for missing/invalid access tokens and by
 * `refreshToken()` for missing/expired sessions (R1.9, R2.11, R3.8, R7.2).
 *
 * Extends NestJS `UnauthorizedException` (HTTP 401) but carries `{ code, message }`
 * on its response object so the shared `HttpExceptionFilter` emits the standard
 * error envelope with `code: AUTH_UNAUTHORIZED` instead of the generic `'ERROR'`.
 */
export class AuthUnauthorizedException extends UnauthorizedException {
  constructor(message = 'Authentication is required') {
    super({
      code: ERROR_CODES.AUTH_UNAUTHORIZED,
      message,
    });
  }
}
