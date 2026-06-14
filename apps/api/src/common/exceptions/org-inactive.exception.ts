import { HttpException, HttpStatus } from '@nestjs/common';
import { ERROR_CODES } from '@queuenow/shared-constants';

/**
 * Domain exception thrown when the requesting User has a Membership in the target
 * Organization but that Organization's `isActive` is false (R2.9, R3.9, R7.4).
 *
 * Carries `{ code, message }` on its response object so the shared
 * `HttpExceptionFilter` emits the standard error envelope with
 * `code: ORG_INACTIVE`, and reports HTTP 403 via `getStatus()`.
 */
export class OrgInactiveException extends HttpException {
  constructor(message = 'This organization is inactive') {
    super(
      {
        code: ERROR_CODES.ORG_INACTIVE,
        message,
      },
      HttpStatus.FORBIDDEN,
    );
  }
}
