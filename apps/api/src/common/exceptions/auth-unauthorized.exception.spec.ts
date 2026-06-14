import type { ArgumentsHost } from '@nestjs/common';
import { HttpStatus } from '@nestjs/common';
import { ERROR_CODES } from '@queuenow/shared-constants';
import { HttpExceptionFilter } from '../filters/http-exception.filter';
import { AuthUnauthorizedException } from './auth-unauthorized.exception';

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
      getRequest: () => ({ url: '/organizations/current', method: 'GET' }),
    }),
  } as unknown as ArgumentsHost;

  filter.catch(exception, host);

  return captured as CapturedResponse;
}

describe('AuthUnauthorizedException', () => {
  // Requirements: 7.6
  it('carries the AUTH_UNAUTHORIZED code and HTTP 401 status', () => {
    const exception = new AuthUnauthorizedException();

    expect(exception.getStatus()).toBe(HttpStatus.UNAUTHORIZED);
    expect(exception.getResponse()).toEqual({
      code: ERROR_CODES.AUTH_UNAUTHORIZED,
      message: 'Authentication is required',
    });
  });

  it('preserves a custom message on its response', () => {
    const exception = new AuthUnauthorizedException('Token expired');

    expect(exception.getStatus()).toBe(HttpStatus.UNAUTHORIZED);
    expect(exception.getResponse()).toEqual({
      code: ERROR_CODES.AUTH_UNAUTHORIZED,
      message: 'Token expired',
    });
  });
});

describe('AuthUnauthorizedException through HttpExceptionFilter', () => {
  // Requirements: 7.6
  it('yields the standard envelope with AUTH_UNAUTHORIZED and HTTP 401', () => {
    const result = runThroughFilter(new AuthUnauthorizedException());

    expect(result.status).toBe(401);
    expect(result.body.success).toBe(false);
    expect(result.body.error.code).toBe(ERROR_CODES.AUTH_UNAUTHORIZED);
    expect(typeof result.body.error.message).toBe('string');
    expect(result.body.error.message.length).toBeGreaterThan(0);
  });
});
