import { Inject, Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import Redis from 'ioredis';

@Injectable()
export class HealthService implements OnModuleDestroy {
  private readonly logger = new Logger(HealthService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject('HEALTH_REDIS_CLIENT') private readonly redis: Redis,
  ) {}

  async check() {
    const [databaseResult, redisResult] = await Promise.allSettled([
      this.prisma.$queryRaw`SELECT 1`,
      this.redis.ping(),
    ]);
    const database = databaseResult.status === 'fulfilled' ? 'connected' : 'disconnected';
    const redis = redisResult.status === 'fulfilled' ? 'connected' : 'disconnected';

    if (database === 'disconnected') {
      this.logger.warn('Database health check failed.');
    }
    if (redis === 'disconnected') {
      this.logger.warn('Redis health check failed.');
    }

    return {
      status: database === 'connected' && redis === 'connected' ? 'ok' : 'error',
      database,
      redis,
      timestamp: new Date().toISOString(),
    };
  }

  onModuleDestroy(): void {
    this.redis.disconnect();
  }
}
