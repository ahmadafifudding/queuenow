import type { ArgumentsHost } from '@nestjs/common';
import { HttpExceptionFilter } from '../filters/http-exception.filter';
import { OrgNotFoundException } from './org-not-found.exception';

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
      getRequest: () => ({ url: '/organizations/missing', method: 'GET' }),
    }),
  } as unknown as ArgumentsHost;

  filter.catch(exception, host);

  return captured as CapturedResponse;
}

describe('OrgNotFoundException through HttpExceptionFilter', () => {
  // Requirements: 3.4, 6.5
  it('yields the standard envelope with ORG_NOT_FOUND and HTTP 404', () => {
    const result = runThroughFilter(new OrgNotFoundException());

    expect(result.status).toBe(404);
    expect(result.body.success).toBe(false);
    expect(result.body.error.code).toBe('ORG_NOT_FOUND');
    expect(typeof result.body.error.message).toBe('string');
    expect(result.body.error.message.length).toBeGreaterThan(0);
  });

  it('preserves a custom message', () => {
    const result = runThroughFilter(new OrgNotFoundException('No such org 123'));

    expect(result.status).toBe(404);
    expect(result.body.error.code).toBe('ORG_NOT_FOUND');
    expect(result.body.error.message).toBe('No such org 123');
  });
});
