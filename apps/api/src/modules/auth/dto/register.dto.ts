import { IsEmail, IsString, MinLength, IsOptional, IsEnum } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

enum OrganizationType {
  CLINIC = 'CLINIC',
  BANK = 'BANK',
  RESTAURANT = 'RESTAURANT',
  GOVERNMENT = 'GOVERNMENT',
  OTHER = 'OTHER',
}

export class RegisterDto {
  @ApiProperty({ example: 'owner@klinik-abc.com' })
  @IsEmail()
  email!: string;

  @ApiProperty({ example: 'SecurePassword123!' })
  @IsString()
  @MinLength(8)
  password!: string;

  @ApiProperty({ example: 'Ahmad bin Ali' })
  @IsString()
  @MinLength(2)
  fullName!: string;

  @ApiPropertyOptional({ example: '+60123456789' })
  @IsOptional()
  @IsString()
  phone?: string;

  @ApiProperty({ example: 'Klinik ABC' })
  @IsString()
  @MinLength(2)
  organizationName!: string;

  @ApiProperty({ enum: OrganizationType, example: 'CLINIC' })
  @IsEnum(OrganizationType)
  organizationType!: OrganizationType;
}
