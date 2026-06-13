import { IsString, IsOptional, IsUUID } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class JoinQueueDto {
  @ApiProperty({
    example: '550e8400-e29b-41d4-a716-446655440000',
    description: 'Service ID to join queue for',
  })
  @IsUUID()
  serviceId!: string;

  @ApiPropertyOptional({
    example: 'Ahmad bin Ali',
    description: 'Customer name (if required by org settings)',
  })
  @IsOptional()
  @IsString()
  customerName?: string;

  @ApiPropertyOptional({
    example: '+60123456789',
    description: 'Customer phone (if required by org settings)',
  })
  @IsOptional()
  @IsString()
  customerPhone?: string;

  @ApiPropertyOptional({
    example: '550e8400-e29b-41d4-a716-446655440000',
    description: 'Customer profile ID (if logged in via mobile app)',
  })
  @IsOptional()
  @IsUUID()
  customerProfileId?: string;

  @ApiPropertyOptional({ description: 'Device fingerprint for abuse prevention' })
  @IsOptional()
  @IsString()
  deviceFingerprint?: string;
}
