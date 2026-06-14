import {
  IsString,
  IsOptional,
  IsBoolean,
  IsInt,
  Min,
  Max,
  MinLength,
  MaxLength,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateServiceDto {
  @ApiProperty({ example: 'Consultation', description: 'Service name' })
  @IsString()
  @MinLength(2)
  @MaxLength(255)
  name!: string;

  @ApiProperty({ example: 'A', description: 'Ticket prefix (1-3 characters)' })
  @IsString()
  @MinLength(1)
  @MaxLength(3)
  prefix!: string;

  @ApiPropertyOptional({ example: true, description: 'Whether service is active' })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional({ example: 0, description: 'Display sort order' })
  @IsOptional()
  @IsInt()
  @Min(0)
  sortOrder?: number;

  @ApiPropertyOptional({
    example: 50,
    description: 'Maximum queue entries per day (null = unlimited)',
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  maxQueuePerDay?: number;

  @ApiPropertyOptional({ example: 5, description: 'Average serving time in minutes' })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(120)
  avgServingTime?: number;
}
