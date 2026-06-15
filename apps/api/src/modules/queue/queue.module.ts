import { Module } from '@nestjs/common';
import { QueueController } from './queue.controller';
import { QueueService } from './queue.service';
import { QueueGateway } from './queue.gateway';
import { NotificationModule } from '../notification/notification.module';

@Module({
  imports: [NotificationModule], // one-way dependency; NotificationModule must NOT import QueueModule
  controllers: [QueueController],
  providers: [QueueService, QueueGateway],
  exports: [QueueService, QueueGateway],
})
export class QueueModule {}
