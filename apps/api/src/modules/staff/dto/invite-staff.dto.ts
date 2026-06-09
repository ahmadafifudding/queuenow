import { IsEmail, IsEnum, IsOptional, IsUUID } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

enum StaffRole {
  ADMIN = 'ADMIN',
  STAFF = 'STAFF',
}

export class InviteStaffDto {
  @ApiProperty({ example: 'sarah@klinik-abc.com', description: 'Email address to invite' })
  @IsEmail()
  email: string;

  @ApiPropertyOptional({ enum: StaffRole, example: 'STAFF', description: 'Role to assign (default: STAFF)' })
  @IsOptional()
  @IsEnum(StaffRole)
  role?: StaffRole;

  @ApiPropertyOptional({ example: '550e8400-e29b-41d4-a716-446655440000', description: 'Service ID to assign staff to' })
  @IsOptional()
  @IsUUID()
  serviceId?: string;
}
