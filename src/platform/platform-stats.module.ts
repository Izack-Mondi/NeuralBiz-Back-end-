import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PrismaModule } from '../prisma/prisma.module';
import { PlatformStatsResolver } from './platform-stats.resolver';
import { PlatformStatsService } from './platform-stats.service';

@Module({
  imports: [AuthModule, PrismaModule],
  providers: [PlatformStatsResolver, PlatformStatsService],
})
export class PlatformStatsModule {}
