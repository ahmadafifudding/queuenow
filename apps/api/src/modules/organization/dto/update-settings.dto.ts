import { IsBoolean, IsInt, IsOptional, IsString, Matches, Max, Min } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class UpdateSettingsDto {
  @ApiPropertyOptional({ example: '00:00', description: 'Daily queue reset time (HH:MM format)' })
  @IsOptional()
  @IsString()
  @Matches(/^\d{2}:\d{2}$/, { message: 'resetTime must be in HH:MM format' })
  resetTime?: string;

  @ApiPropertyOptional({ example: 2, description: 'Maximum recall attempts before suggesting skip' })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(5)
  maxRecall?: number;

  @ApiPropertyOptional({ example: false, description: 'Require customer name when joining queue' })
  @IsOptional()
  @IsBoolean()
  requireName?: boolean;

  @ApiPropertyOptional({ example: false, description: 'Require customer phone when joining queue' })
  @IsOptional()
  @IsBoolean()
  requirePhone?: boolean;

  @ApiPropertyOptional({ example: 10, description: 'Auto-skip timeout in minutes (null = disabled)' })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(60)
  autoSkipTimeout?: number;
}
