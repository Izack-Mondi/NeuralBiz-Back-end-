import { Query, Resolver } from '@nestjs/graphql';
import { UseGuards } from '@nestjs/common';
import { GqlAuthGuard } from '../auth/gql-auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { PlatformStats } from './platform-stats.types';
import { PlatformStatsService } from './platform-stats.service';

@Resolver()
export class PlatformStatsResolver {
  constructor(private readonly platformStatsService: PlatformStatsService) {}

  @Query(() => PlatformStats)
  @UseGuards(GqlAuthGuard)
  platformStats(@CurrentUser() user: { sub: string }): Promise<PlatformStats> {
    return this.platformStatsService.getPlatformStats(user.sub);
  }
}
