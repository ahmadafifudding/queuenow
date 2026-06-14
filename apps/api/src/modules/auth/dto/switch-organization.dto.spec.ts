import 'reflect-metadata';

import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import { SwitchOrganizationDto } from './switch-organization.dto';

/**
 * Task 2.2 — validation error path for the switch-organization endpoint.
 *
 * The unit under test is {@link SwitchOrganizationDto} (`@IsUUID()` on `orgId`).
 * A missing or non-UUID `orgId` must produce a class-validator violation so the
 * global `ValidationPipe` rejects the request with `VALIDATION_ERROR` (R2.12),
 * while a valid UUID passes validation. This is the standard way to unit-test a
 * DTO: build an instance with `plainToInstance` and run `validate()`.
 *
 * _Requirements: 2.12_
 */
describe('SwitchOrganizationDto validation (R2.12)', () => {
  const VALID_UUIDS: readonly string[] = [
    '00000000-0000-4000-8000-000000000000',
    'f47ac10b-58cc-4372-a567-0e02b2c3d479',
    '9a7b3c2d-1e4f-4a6b-8c9d-0e1f2a3b4c5d',
  ];

  it.each(VALID_UUIDS)('accepts the valid UUID %s with no violations', async (orgId) => {
    const dto = plainToInstance(SwitchOrganizationDto, { orgId });

    const errors = await validate(dto);

    expect(errors).toHaveLength(0);
  });

  it.each([
    ['a non-UUID string', 'not-a-uuid'],
    ['an empty string', ''],
    ['a numeric-only string', '12345'],
    ['a malformed UUID (too short)', 'f47ac10b-58cc-4372-a567'],
    ['a numeric value', 1],
    ['null', null],
    ['undefined (missing)', undefined],
  ])('rejects %s with an isUuid constraint violation', async (_label, value) => {
    const dto = plainToInstance(SwitchOrganizationDto, { orgId: value });

    const errors = await validate(dto);

    expect(errors).toHaveLength(1);
    const [error] = errors;
    expect(error.property).toBe('orgId');
    expect(error.constraints).toBeDefined();
    expect(error.constraints).toHaveProperty('isUuid');
  });

  it('reports the offending property as `orgId` (drives VALIDATION_ERROR details)', async () => {
    const dto = plainToInstance(SwitchOrganizationDto, { orgId: 'not-a-uuid' });

    const errors = await validate(dto);

    expect(errors.map((e) => e.property)).toEqual(['orgId']);
  });
});
