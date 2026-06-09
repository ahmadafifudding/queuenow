import { IsString, IsOptional, IsBoolean, IsUUID, MinLength, MaxLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateCounterDto {
  @ApiProperty({ example: '550e8400-e29b-41d4-a716-446655440000', description: 'Service ID this counter belongs to' })
  @IsUUID()
  serviceId: string;

  @ApiProperty({ example: 'Counter 1', description: 'Counter name/label' })
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  name: string;

  @ApiPropertyOptional({ example: true, description: 'Whether counter is active' })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
