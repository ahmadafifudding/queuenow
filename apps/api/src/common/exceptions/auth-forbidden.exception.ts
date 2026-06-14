import { HttpException, HttpStatus } from '@nestjs/common';
import { ERROR_CODES } from '@queuenow/shared-constants';

/**
 * Domain exception thrown when the requesting User is not authorized to reach a
 * target Organization — either they have no Membership in it or the Organization
 * does not exist. The two cases are deliberately indistinguishable to prevent
 * organization enumeration (R2.7, R2.8, R3.4, R7.3).
 *
 * Carries `{ code, message }` on its response object so the shared
 * `HttpExceptionFilter` emits the standard error envelope with
 * `code: AUTH_FORBIDDEN`, and reports HTTP 403 via `getStatus()`.
 */
export class AuthForbiddenException extends HttpException {
  constructor(message = 'You do not have access to that organization') {
    super(
      {
        code: ERROR_CODES.AUTH_FORBIDDEN,
        message,
      },
      HttpStatus.FORBIDDEN,
    );
  }
}
