import { HttpException, HttpStatus } from '@nestjs/common';
import { ERROR_CODES } from '@queuenow/shared-constants';

/**
 * Domain exception thrown when an `orgId` does not resolve to an existing
 * Organization (R3.4, R6.5).
 *
 * Carries `{ code, message }` on its response object so the shared
 * `HttpExceptionFilter` emits the standard error envelope with
 * `code: ORG_NOT_FOUND`, and reports HTTP 404 via `getStatus()`.
 */
export class OrgNotFoundException extends HttpException {
  constructor(message = 'Organization not found') {
    super(
      {
        code: ERROR_CODES.ORG_NOT_FOUND,
        message,
      },
      HttpStatus.NOT_FOUND,
    );
  }
}
