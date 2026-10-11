import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { PrismaModule } from '../prisma/prisma.module';
import { PrismaService } from '../prisma/prisma.service';
import { StorageModule } from '../storage/storage.module';
import { VideoProcessingJob } from './video-processing.job';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { configValidationSchema } from '../config/env-validation.schema';
import { VideoProcessingWorker } from './video-processing.worker';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      validationSchema: configValidationSchema,
    }),
    PrismaModule,
    StorageModule,
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
  ],
  providers: [
    {
      provide: 'VideoProcessingJob',
      useFactory: (prisma, storage, config) => new VideoProcessingJob(prisma, storage, config),
      inject: [PrismaService, 'STORAGE_SERVICE', ConfigService],
    },
    VideoProcessingWorker,
  ],
  exports: [],
})
export class WorkerModule {}
