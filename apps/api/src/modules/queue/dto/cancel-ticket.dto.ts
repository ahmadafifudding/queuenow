import { IsString, IsOptional, IsUUID } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

/**
 * Body for the public, ownership-scoped ticket cancellation endpoint
 * (POST /organizations/:orgId/queue/ticket/:ticketId/cancel).
 *
 * The caller proves ownership of the target Ticket by supplying the same
 * `deviceFingerprint` and/or `customerProfileId` the Ticket was created with
 * (see JoinQueueDto). At least one must match the stored Ticket; otherwise the
 * request is rejected with AUTH_FORBIDDEN. Both fields are optional at the
 * validation layer because either one alone is sufficient to authorize.
 */
export class CancelTicketDto {
  @ApiPropertyOptional({
    description: 'Device fingerprint the ticket was created with (anonymous ownership proof)',
  })
  @IsOptional()
  @IsString()
  deviceFingerprint?: string;

  @ApiPropertyOptional({
    example: '550e8400-e29b-41d4-a716-446655440000',
    description: 'Customer profile ID the ticket was created with (signed-in ownership proof)',
  })
  @IsOptional()
  @IsUUID()
  customerProfileId?: string;
}
