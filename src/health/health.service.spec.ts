import { PrismaService } from '../prisma/prisma.service';
import { HealthService } from './health.service';

describe('HealthService', () => {
  const createHealthService = (databaseHealthy: boolean, redisHealthy: boolean) => {
    const prisma = {
      $queryRaw: jest.fn().mockImplementation(() =>
        databaseHealthy ? Promise.resolve([{ '?column?': 1 }]) : Promise.reject(new Error('database down')),
      ),
    };
    const redis = {
      ping: jest.fn().mockImplementation(() =>
        redisHealthy ? Promise.resolve('PONG') : Promise.reject(new Error('redis down')),
      ),
      disconnect: jest.fn(),
    };
    const service = new HealthService(
      prisma as unknown as PrismaService,
      redis as never,
    );

    return { service, prisma, redis };
  };

  it('reports healthy only when both dependencies respond', async () => {
    const { service, prisma, redis } = createHealthService(true, true);

    await expect(service.check()).resolves.toMatchObject({
      status: 'ok',
      database: 'connected',
      redis: 'connected',
    });
    expect(prisma.$queryRaw).toHaveBeenCalled();
    expect(redis.ping).toHaveBeenCalled();
  });

  it('reports a dependency failure without leaking the error', async () => {
    const { service } = createHealthService(false, true);

    await expect(service.check()).resolves.toMatchObject({
      status: 'error',
      database: 'disconnected',
      redis: 'connected',
    });
  });

  it('reports unhealthy when Redis is unavailable', async () => {
    const { service } = createHealthService(true, false);

    await expect(service.check()).resolves.toMatchObject({
      status: 'error',
      database: 'connected',
      redis: 'disconnected',
    });
  });

  it('closes the Redis health client on shutdown', () => {
    const { service, redis } = createHealthService(true, true);

    service.onModuleDestroy();

    expect(redis.disconnect).toHaveBeenCalled();
  });
});
