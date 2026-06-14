import type { ArgumentsHost } from '@nestjs/common';
import { HttpStatus } from '@nestjs/common';
import { ERROR_CODES } from '@queuenow/shared-constants';
import { HttpExceptionFilter } from '../filters/http-exception.filter';
import { AuthForbiddenException } from './auth-forbidden.exception';

interface CapturedResponse {
  status: number;
  body: {
    success: boolean;
    error: {
      code: string;
      message: string;
      details?: Record<string, unknown>;
    };
    meta: Record<string, unknown>;
  };
}

function runThroughFilter(exception: unknown): CapturedResponse {
  const filter = new HttpExceptionFilter();
  const captured: Partial<CapturedResponse> = {};

  const response = {
    status(code: number) {
      captured.status = code;
      return this;
    },
    json(body: CapturedResponse['body']) {
      captured.body = body;
      return this;
    },
  };

  const host = {
    switchToHttp: () => ({
      getResponse: () => response,
      getRequest: () => ({ url: '/organizations/forbidden', method: 'GET' }),
    }),
  } as unknown as ArgumentsHost;

  filter.catch(exception, host);

  return captured as CapturedResponse;
}

describe('AuthForbiddenException', () => {
  // Requirements: 7.6
  it('carries the AUTH_FORBIDDEN code and HTTP 403 status', () => {
    const exception = new AuthForbiddenException();

    expect(exception.getStatus()).toBe(HttpStatus.FORBIDDEN);
    expect(exception.getResponse()).toEqual({
      code: ERROR_CODES.AUTH_FORBIDDEN,
      message: 'You do not have access to that organization',
    });
  });

  it('preserves a custom message on its response', () => {
    const exception = new AuthForbiddenException('Nope');

    expect(exception.getStatus()).toBe(HttpStatus.FORBIDDEN);
    expect(exception.getResponse()).toEqual({
      code: ERROR_CODES.AUTH_FORBIDDEN,
      message: 'Nope',
    });
  });
});

describe('AuthForbiddenException through HttpExceptionFilter', () => {
  // Requirements: 7.6
  it('yields the standard envelope with AUTH_FORBIDDEN and HTTP 403', () => {
    const result = runThroughFilter(new AuthForbiddenException());

    expect(result.status).toBe(403);
    expect(result.body.success).toBe(false);
    expect(result.body.error.code).toBe(ERROR_CODES.AUTH_FORBIDDEN);
    expect(typeof result.body.error.message).toBe('string');
    expect(result.body.error.message.length).toBeGreaterThan(0);
  });
});
