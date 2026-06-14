import 'reflect-metadata';

import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { PlanType } from '@queuenow/shared-types';

import { ChangePlanDto } from './change-plan.dto';

/**
 * Task 9.5 — validation error path for the manual plan-change endpoint.
 *
 * The unit under test is {@link ChangePlanDto} (`@IsEnum(PlanType)` on `plan`).
 * A non-enum target plan must produce a class-validator violation so the global
 * `ValidationPipe` rejects the request with `VALIDATION_ERROR` (R6.4), while
 * every valid {@link PlanType} passes validation. This is the standard way to
 * unit-test a DTO: build an instance with `plainToInstance` and run `validate()`.
 *
 * _Requirements: 6.4_
 */
describe('ChangePlanDto validation (R6.4)', () => {
  const VALID_PLANS: readonly PlanType[] = [
    PlanType.FREE,
    PlanType.BASIC,
    PlanType.PRO,
    PlanType.ENTERPRISE,
  ];

  it.each(VALID_PLANS)('accepts the valid plan %s with no violations', async (plan) => {
    const dto = plainToInstance(ChangePlanDto, { plan });

    const errors = await validate(dto);

    expect(errors).toHaveLength(0);
  });

  it.each([
    ['a non-enum string', 'GOLD'],
    ['an empty string', ''],
    ['a lowercase variant', 'free'],
    ['a numeric value', 1],
    ['null', null],
    ['undefined (missing)', undefined],
  ])('rejects %s with an isEnum constraint violation', async (_label, value) => {
    const dto = plainToInstance(ChangePlanDto, { plan: value });

    const errors = await validate(dto);

    expect(errors).toHaveLength(1);
    const [error] = errors;
    expect(error.property).toBe('plan');
    expect(error.constraints).toBeDefined();
    expect(error.constraints).toHaveProperty('isEnum');
  });

  it('reports the offending property as `plan` (drives VALIDATION_ERROR details)', async () => {
    const dto = plainToInstance(ChangePlanDto, { plan: 'NOT_A_PLAN' });

    const errors = await validate(dto);

    expect(errors.map((e) => e.property)).toEqual(['plan']);
  });
});
