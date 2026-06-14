import { describe, expect, it } from 'vitest';

import { ERROR_CODES } from './index';

describe('ERROR_CODES.PLAN_LIMIT_EXCEEDED', () => {
  it('is present', () => {
    expect(ERROR_CODES).toHaveProperty('PLAN_LIMIT_EXCEEDED');
  });

  it("equals 'PLAN_LIMIT_EXCEEDED'", () => {
    expect(ERROR_CODES.PLAN_LIMIT_EXCEEDED).toBe('PLAN_LIMIT_EXCEEDED');
  });
});
