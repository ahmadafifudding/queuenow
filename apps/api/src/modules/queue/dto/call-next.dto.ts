import { IsUUID } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CallNextDto {
  @ApiProperty({ example: '550e8400-e29b-41d4-a716-446655440000', description: 'Counter ID to call next customer from' })
  @IsUUID()
  counterId: string;
}
