import { HttpException, HttpStatus } from '@nestjs/common';
import type { ValidationError } from '@nestjs/common';
import { ERROR_CODES } from '@queuenow/shared-constants';

/**
 * Per-field validation messages, keyed by the DTO property that failed.
 * Only the human-readable constraint messages produced by `class-validator`
 * are surfaced — never stack traces or internal exception details (R7.5).
 */
export interface ValidationDetails {
  fields: Record<string, string[]>;
}

/**
 * Flatten `class-validator` `ValidationError[]` (including nested errors) into a
 * safe, serializable `{ fields: { property: messages[] } }` shape. Constraint
 * messages are the only thing copied across, so no stack traces or internal
 * values leak into the error envelope (R7.5).
 */
export function buildValidationDetails(errors: ValidationError[]): ValidationDetails {
  const fields: Record<string, string[]> = {};

  const visit = (error: ValidationError, parentPath: string): void => {
    const path = parentPath ? `${parentPath}.${error.property}` : error.property;

    if (error.constraints) {
      const messages = Object.values(error.constraints);
      if (messages.length > 0) {
        fields[path] = [...(fields[path] ?? []), ...messages];
      }
    }

    if (error.children && error.children.length > 0) {
      for (const child of error.children) {
        visit(child, path);
      }
    }
  };

  for (const error of errors) {
    visit(error, '');
  }

  return { fields };
}

/**
 * Domain exception thrown by the global `ValidationPipe` `exceptionFactory` when
 * a request body/params fail DTO validation.
 *
 * Carries `{ code, message, details }` on its response object so the shared
 * `HttpExceptionFilter` emits the standard error envelope with
 * `code: VALIDATION_ERROR` (not the generic `'ERROR'`), and reports HTTP 400
 * via `getStatus()`. The `details.fields` map holds only the safe per-field
 * constraint messages — no stack traces (R2.12, R7.5, R7.6).
 */
export class ValidationException extends HttpException {
  constructor(errors: ValidationError[], message = 'Validation failed') {
    super(
      {
        code: ERROR_CODES.VALIDATION_ERROR,
        message,
        details: buildValidationDetails(errors),
      },
      HttpStatus.BAD_REQUEST,
    );
  }
}
