import type { ArgumentsHost } from '@nestjs/common';
import { HttpStatus } from '@nestjs/common';
import { ERROR_CODES } from '@queuenow/shared-constants';
import { HttpExceptionFilter } from '../filters/http-exception.filter';
import { OrgInactiveException } from './org-inactive.exception';

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
      getRequest: () => ({ url: '/organizations/inactive', method: 'GET' }),
    }),
  } as unknown as ArgumentsHost;

  filter.catch(exception, host);

  return captured as CapturedResponse;
}

describe('OrgInactiveException', () => {
  // Requirements: 7.6
  it('carries the ORG_INACTIVE code and HTTP 403 status', () => {
    const exception = new OrgInactiveException();

    expect(exception.getStatus()).toBe(HttpStatus.FORBIDDEN);
    expect(exception.getResponse()).toEqual({
      code: ERROR_CODES.ORG_INACTIVE,
      message: 'This organization is inactive',
    });
  });

  it('preserves a custom message on its response', () => {
    const exception = new OrgInactiveException('Org 42 is suspended');

    expect(exception.getStatus()).toBe(HttpStatus.FORBIDDEN);
    expect(exception.getResponse()).toEqual({
      code: ERROR_CODES.ORG_INACTIVE,
      message: 'Org 42 is suspended',
    });
  });
});

describe('OrgInactiveException through HttpExceptionFilter', () => {
  // Requirements: 7.6
  it('yields the standard envelope with ORG_INACTIVE and HTTP 403', () => {
    const result = runThroughFilter(new OrgInactiveException());

    expect(result.status).toBe(403);
    expect(result.body.success).toBe(false);
    expect(result.body.error.code).toBe(ERROR_CODES.ORG_INACTIVE);
    expect(typeof result.body.error.message).toBe('string');
    expect(result.body.error.message.length).toBeGreaterThan(0);
  });
});
