import { IsUUID } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class SwitchOrganizationDto {
  @ApiProperty({
    format: 'uuid',
    description: 'Target organization id to switch to',
  })
  @IsUUID()
  orgId!: string;
}
