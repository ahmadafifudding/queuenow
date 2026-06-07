import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerModule } from '@nestjs/throttler';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './modules/auth/auth.module';
import { OrganizationModule } from './modules/organization/organization.module';
import { ServiceModule } from './modules/service/service.module';
import { CounterModule } from './modules/counter/counter.module';
import { StaffModule } from './modules/staff/staff.module';
import { QueueModule } from './modules/queue/queue.module';
import { DisplayModule } from './modules/display/display.module';
import { CustomerModule } from './modules/customer/customer.module';
import { NotificationModule } from './modules/notification/notification.module';
import { QrCodeModule } from './modules/qr-code/qr-code.module';

@Module({
  imports: [
    // Config
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: [`.env.${process.env.NODE_ENV}`, '.env'],
    }),

    // Rate limiting
    ThrottlerModule.forRoot([
      {
        ttl: 60000,
        limit: 60,
      },
    ]),

    // Event emitter for cross-module communication
    EventEmitterModule.forRoot(),

    // Database
    PrismaModule,

    // Feature modules
    AuthModule,
    OrganizationModule,
    ServiceModule,
    CounterModule,
    StaffModule,
    QueueModule,
    DisplayModule,
    CustomerModule,
    NotificationModule,
    QrCodeModule,
  ],
})
export class AppModule {}
