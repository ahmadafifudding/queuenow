import { IsEnum } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { PlanType } from '@queuenow/shared-types';

export class ChangePlanDto {
  @ApiProperty({
    enum: PlanType,
    example: PlanType.PRO,
    description: 'Target plan for the organization',
  })
  @IsEnum(PlanType)
  plan!: PlanType;
}
