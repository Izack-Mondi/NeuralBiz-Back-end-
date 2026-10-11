import { ForbiddenException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { PlatformStatsService } from './platform-stats.service';

describe('PlatformStatsService', () => {
  it('rejects a caller whose email is not configured as an administrator', async () => {
    const prisma = {
      user: { findUnique: jest.fn().mockResolvedValue({ email: 'user@example.com' }) },
    };
    const config = { get: jest.fn().mockReturnValue('admin@example.com') };
    const service = new PlatformStatsService(
      prisma as unknown as PrismaService,
      config as unknown as ConfigService,
    );

    await expect(service.getPlatformStats('user-1')).rejects.toThrow(ForbiddenException);
    expect(prisma.user.findUnique).toHaveBeenCalledWith({
      where: { id: 'user-1' },
      select: { email: true },
    });
  });

  it('returns platform counts to an administrator email', async () => {
    const prisma = {
      user: {
        findUnique: jest.fn().mockResolvedValue({ email: 'ADMIN@example.com' }),
        count: jest.fn().mockResolvedValue(18),
      },
      post: {
        count: jest.fn().mockResolvedValue(4),
        groupBy: jest.fn().mockResolvedValue([{ authorId: 'user-1' }, { authorId: 'user-2' }]),
      },
      product: { count: jest.fn().mockResolvedValue(3) },
      serviceOffering: { count: jest.fn().mockResolvedValue(2) },
      mediaAsset: { count: jest.fn().mockResolvedValueOnce(5).mockResolvedValueOnce(1) },
    };
    const config = { get: jest.fn().mockReturnValue('other@example.com, admin@example.com') };
    const service = new PlatformStatsService(
      prisma as unknown as PrismaService,
      config as unknown as ConfigService,
    );

    await expect(service.getPlatformStats('admin-1')).resolves.toEqual({
      users: 18,
      posts: 4,
      products: 3,
      offerings: 2,
      readyVideos: 5,
      rejectedVideos: 1,
      activePosters: 2,
      postsLast7Days: 4,
    });
  });
});
