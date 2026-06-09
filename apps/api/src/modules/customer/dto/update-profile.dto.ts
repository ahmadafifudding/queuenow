import { IsString, IsOptional, IsUrl, MinLength, MaxLength } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class UpdateProfileDto {
  @ApiPropertyOptional({ example: 'Ali bin Abu', description: 'Full name' })
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(255)
  fullName?: string;

  @ApiPropertyOptional({ example: '+60123456789', description: 'Phone number' })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  phone?: string;

  @ApiPropertyOptional({ example: 'https://storage.example.com/avatar.jpg', description: 'Avatar image URL' })
  @IsOptional()
  @IsUrl()
  avatarUrl?: string;
}
