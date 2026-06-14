import { IsString, IsNotEmpty } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

/**
 * Body for `POST /customers/refresh`. Unlike the web auth flow (which reads the
 * Refresh_Token from an httpOnly cookie), the mobile client holds the token in
 * secure storage and presents it in the request body (R12.2).
 */
export class RefreshCustomerDto {
  @ApiProperty({
    example: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...',
    description: 'The customer refresh token held in device secure storage',
  })
  @IsString()
  @IsNotEmpty()
  refreshToken!: string;
}
