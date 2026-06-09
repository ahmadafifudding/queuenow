import { IsString, MinLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class RegisterPushTokenDto {
  @ApiProperty({ description: 'Firebase Cloud Messaging (FCM) push token from device' })
  @IsString()
  @MinLength(1)
  pushToken: string;
}
