import { Module } from '@nestjs/common';
import { HealthController } from './health.controller';
import { HealthService } from './health.service';
import { PrismaModule } from '../prisma/prisma.module';
import { ConfigModule, ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

@Module({
  imports: [PrismaModule, ConfigModule],
  controllers: [HealthController],
  providers: [
    HealthService,
    {
      provide: 'HEALTH_REDIS_CLIENT',
      inject: [ConfigService],
      useFactory: (config: ConfigService) =>
        new Redis({
          host: config.get<string>('REDIS_HOST') || 'localhost',
          port: Number(config.get<string>('REDIS_PORT') || 6379),
          lazyConnect: true,
          enableOfflineQueue: false,
          maxRetriesPerRequest: 1,
          connectTimeout: 2000,
        }),
    },
  ],
})
export class HealthModule {}
