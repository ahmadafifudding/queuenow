import type { ArgumentsHost } from '@nestjs/common';
import fc from 'fast-check';
import { PlanType } from '@queuenow/shared-types';
import type { FeatureFlag, PlanLimitName } from '@queuenow/shared-types';
import { HttpExceptionFilter } from '../filters/http-exception.filter';
import {
  PlanLimitExceededException,
  type FeatureFlagDetails,
  type NumericLimitDetails,
} from './plan-limit-exceeded.exception';

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

/**
 * Run an exception through the REAL `HttpExceptionFilter` and capture the
 * HTTP status code and JSON envelope it produces.
 */
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
      getRequest: () => ({ url: '/test', method: 'POST' }),
    }),
  } as unknown as ArgumentsHost;

  filter.catch(exception, host);

  return captured as CapturedResponse;
}

const LIMIT_NAMES: PlanLimitName[] = ['maxServices', 'maxCounters', 'maxStaff', 'maxQueuePerDay'];

const FEATURE_FLAGS: FeatureFlag[] = ['tvDisplay', 'analytics', 'customBranding'];

const numericDetailsArb: fc.Arbitrary<NumericLimitDetails> = fc.record({
  limitName: fc.constantFrom(...LIMIT_NAMES),
  limit: fc.integer({ min: 0, max: 100_000 }),
  currentUsage: fc.integer({ min: 0, max: 100_000 }),
  plan: fc.constantFrom(...(Object.values(PlanType) as PlanType[])),
});

const featureDetailsArb: fc.Arbitrary<FeatureFlagDetails> = fc.record({
  flag: fc.constantFrom(...FEATURE_FLAGS),
  plan: fc.constantFrom(...(Object.values(PlanType) as PlanType[])),
});

// Feature: plan-limit-enforcement, Property 9: PLAN_LIMIT_EXCEEDED error envelope shape
describe('Property 9: PLAN_LIMIT_EXCEEDED error envelope shape', () => {
  // Validates: Requirements 7.2, 7.3, 7.4, 7.5, 7.6
  it('produces the standard PLAN_LIMIT_EXCEEDED envelope for numeric-limit details', () => {
    fc.assert(
      fc.property(numericDetailsArb, (details) => {
        const result = runThroughFilter(new PlanLimitExceededException(details));

        // R7.6 — HTTP 403
        expect(result.status).toBe(403);
        // R7.2 — success false, code, non-empty message
        expect(result.body.success).toBe(false);
        expect(result.body.error.code).toBe('PLAN_LIMIT_EXCEEDED');
        expect(typeof result.body.error.message).toBe('string');
        expect(result.body.error.message.length).toBeGreaterThan(0);

        const resultDetails = result.body.error.details as Record<string, unknown>;
        // R7.5 — plan always present
        expect(resultDetails.plan).toBe(details.plan);
        // R7.3 — numeric variant carries limitName/limit/currentUsage
        expect(resultDetails.limitName).toBe(details.limitName);
        expect(resultDetails.limit).toBe(details.limit);
        expect(resultDetails.currentUsage).toBe(details.currentUsage);
        expect(typeof resultDetails.limit).toBe('number');
        expect(typeof resultDetails.currentUsage).toBe('number');
        // numeric variant must not carry a feature flag
        expect(resultDetails.flag).toBeUndefined();
      }),
      { numRuns: 200 },
    );
  });

  // Validates: Requirements 7.2, 7.4, 7.5, 7.6
  it('produces the standard PLAN_LIMIT_EXCEEDED envelope for feature-flag details', () => {
    fc.assert(
      fc.property(featureDetailsArb, (details) => {
        const result = runThroughFilter(new PlanLimitExceededException(details));

        // R7.6 — HTTP 403
        expect(result.status).toBe(403);
        // R7.2 — success false, code, non-empty message
        expect(result.body.success).toBe(false);
        expect(result.body.error.code).toBe('PLAN_LIMIT_EXCEEDED');
        expect(typeof result.body.error.message).toBe('string');
        expect(result.body.error.message.length).toBeGreaterThan(0);

        const resultDetails = result.body.error.details as Record<string, unknown>;
        // R7.5 — plan always present
        expect(resultDetails.plan).toBe(details.plan);
        // R7.4 — feature variant carries flag and omits limit/currentUsage
        expect(resultDetails.flag).toBe(details.flag);
        expect(resultDetails.limit).toBeUndefined();
        expect(resultDetails.currentUsage).toBeUndefined();
        expect(resultDetails.limitName).toBeUndefined();
      }),
      { numRuns: 200 },
    );
  });
});
