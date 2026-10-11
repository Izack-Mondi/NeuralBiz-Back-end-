import { Module } from '@nestjs/common';
import { MediaResolver } from './media.resolver';
import { MediaService } from './media.service';
import { CleanupService } from './cleanup.service';
import { PrismaModule } from '../prisma/prisma.module';
import { StorageModule } from '../storage/storage.module';
import { AuthModule } from '../auth/auth.module';
import { BullModule } from '@nestjs/bullmq';
import { ScheduleModule } from '@nestjs/schedule';
import { ConfigModule, ConfigService } from '@nestjs/config';

@Module({
  imports: [
    PrismaModule,
    StorageModule,
    AuthModule,
    BullModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        connection: {
          host: config.get<string>('REDIS_HOST') || 'localhost',
          port: Number(config.get<string>('REDIS_PORT') || 6379),
        },
      }),
    }),
    BullModule.registerQueue({
      name: 'video-processing',
      defaultJobOptions: {
        attempts: 3,
        backoff: {
          type: 'exponential',
          delay: 5000,
        },
        removeOnComplete: 10,
        removeOnFail: 50,
      },
    }),
    ScheduleModule.forRoot(),
  ],
  providers: [MediaResolver, MediaService, CleanupService],
  exports: [MediaService, CleanupService],
})
export class MediaModule {}
