import { IsString, IsOptional, Matches, MaxLength, IsUrl } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class UpdateBrandingDto {
  @ApiPropertyOptional({ example: 'https://storage.example.com/logo.png', description: 'Logo URL' })
  @IsOptional()
  @IsUrl()
  logoUrl?: string;

  @ApiPropertyOptional({ example: '#3B82F6', description: 'Primary brand color (hex)' })
  @IsOptional()
  @IsString()
  @Matches(/^#[0-9A-Fa-f]{6}$/, { message: 'primaryColor must be a valid hex color (e.g., #3B82F6)' })
  primaryColor?: string;

  @ApiPropertyOptional({ example: 'Scan to join queue', description: 'Text displayed on QR code printout' })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  qrText?: string;
}
