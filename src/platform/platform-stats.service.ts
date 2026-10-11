import { ForbiddenException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { PlatformStats } from './platform-stats.types';

@Injectable()
export class PlatformStatsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  async getPlatformStats(userId: string): Promise<PlatformStats> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { email: true },
    });
    const adminEmails = new Set(
      (this.config.get<string>('ADMIN_EMAILS') || '')
        .split(',')
        .map((email) => email.trim().toLowerCase())
        .filter(Boolean),
    );

    if (!user || !adminEmails.has(user.email.toLowerCase())) {
      throw new ForbiddenException('Platform statistics are restricted to administrators');
    }

    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const [
      users,
      posts,
      products,
      offerings,
      readyVideos,
      rejectedVideos,
      activePosters,
      postsLast7Days,
    ] = await Promise.all([
      this.prisma.user.count(),
      this.prisma.post.count(),
      this.prisma.product.count(),
      this.prisma.serviceOffering.count(),
      this.prisma.mediaAsset.count({ where: { kind: 'VIDEO', status: 'READY' } }),
      this.prisma.mediaAsset.count({ where: { kind: 'VIDEO', status: 'REJECTED' } }),
      this.prisma.post.groupBy({
        by: ['authorId'],
        where: { createdAt: { gte: sevenDaysAgo } },
      }),
      this.prisma.post.count({ where: { createdAt: { gte: sevenDaysAgo } } }),
    ]);

    return {
      users,
      posts,
      products,
      offerings,
      readyVideos,
      rejectedVideos,
      activePosters: activePosters.length,
      postsLast7Days,
    };
  }
}
