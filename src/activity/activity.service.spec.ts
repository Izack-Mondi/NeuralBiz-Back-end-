import { PrismaService } from '../prisma/prisma.service';
import { ActivityService } from './activity.service';

describe('ActivityService', () => {
  it('records activity without exposing a storage error to the caller', async () => {
    const prisma = {
      $executeRaw: jest.fn().mockRejectedValue(new Error('database unavailable')),
    };
    const service = new ActivityService(prisma as unknown as PrismaService);

    await expect(
      service.record('POST_CREATED', 'user-1', { postId: 'post-1' }),
    ).resolves.toBeUndefined();
    expect(prisma.$executeRaw).toHaveBeenCalled();
  });
});
