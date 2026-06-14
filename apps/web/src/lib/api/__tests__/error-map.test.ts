import { ERROR_CODES } from '@queuenow/shared-constants';
import { describe, expect, it } from 'vitest';

import { strings } from '@/i18n';
import { getErrorMessage, messageForErrorCode, type ErrorWithCode } from '@/lib/api/error-map';

describe('messageForErrorCode', () => {
  it('returns the curated copy for a known error code', () => {
    expect(messageForErrorCode(ERROR_CODES.AUTH_INVALID_CREDENTIALS)).toBe(
      strings.errors[ERROR_CODES.AUTH_INVALID_CREDENTIALS],
    );
  });

  it('returns the generic fallback for an unknown code', () => {
    expect(messageForErrorCode('SOME_BRAND_NEW_SERVER_CODE')).toBe(strings.errorFallback);
  });

  it('returns the generic fallback for nullish/empty codes', () => {
    expect(messageForErrorCode(undefined)).toBe(strings.errorFallback);
    expect(messageForErrorCode(null)).toBe(strings.errorFallback);
    expect(messageForErrorCode('')).toBe(strings.errorFallback);
  });

  it('never echoes a raw backend message — every result comes from the catalog', () => {
    const rawBackendMessage = 'Prisma: column "secret" violates constraint';
    expect(messageForErrorCode(rawBackendMessage)).toBe(strings.errorFallback);
    expect(messageForErrorCode(rawBackendMessage)).not.toContain('Prisma');
  });
});

describe('getErrorMessage', () => {
  it('resolves a bare code string', () => {
    expect(getErrorMessage(ERROR_CODES.QUEUE_NO_WAITING)).toBe(
      strings.errors[ERROR_CODES.QUEUE_NO_WAITING],
    );
  });

  it('extracts and resolves the code from an ApiError-like object', () => {
    const apiError: ErrorWithCode = { code: ERROR_CODES.QUEUE_MAX_RECALL };
    expect(getErrorMessage(apiError)).toBe(strings.errors[ERROR_CODES.QUEUE_MAX_RECALL]);
  });

  it('falls back for an ApiError-like object with an unknown/missing code', () => {
    expect(getErrorMessage({ code: 'NOPE' })).toBe(strings.errorFallback);
    expect(getErrorMessage({ code: null })).toBe(strings.errorFallback);
    expect(getErrorMessage({})).toBe(strings.errorFallback);
  });

  it('falls back for nullish input', () => {
    expect(getErrorMessage(null)).toBe(strings.errorFallback);
    expect(getErrorMessage(undefined)).toBe(strings.errorFallback);
  });

  it('maps every known ERROR_CODES value to a non-empty catalog message', () => {
    for (const code of Object.values(ERROR_CODES)) {
      const message = getErrorMessage(code);
      expect(message.length).toBeGreaterThan(0);
      expect(message).not.toBe(strings.errorFallback);
    }
  });
});
