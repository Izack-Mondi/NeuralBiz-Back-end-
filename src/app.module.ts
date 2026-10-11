import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { GraphQLModule } from '@nestjs/graphql';
import { ApolloDriver, ApolloDriverConfig } from '@nestjs/apollo';
import { ThrottlerModule } from '@nestjs/throttler';
import { APP_GUARD } from '@nestjs/core';
import depthLimit from 'graphql-depth-limit';
import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './auth/auth.module';
import { FeedModule } from './feed/feed.module';
import { HealthModule } from './health/health.module';
import { MediaModule } from './media/media.module';
import { ServiceOfferingsModule } from './service-offerings/service-offerings.module';
import { GqlThrottlerGuard } from './common/gql-throttler.guard';
import { StorageModule } from './storage/storage.module';
import { configValidationSchema } from './config/env-validation.schema';
import { ActivityModule } from './activity/activity.module';
import { PlatformStatsModule } from './platform/platform-stats.module';
import { NetworkModule } from './network/network.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      validationSchema: configValidationSchema,
    }),
    ThrottlerModule.forRoot([
      {
        ttl: 60000, // 1 minute
        limit: 60, // 60 requests per minute
      },
    ]),
    GraphQLModule.forRoot<ApolloDriverConfig>({
      driver: ApolloDriver,
      autoSchemaFile: true,
      sortSchema: true,
      context: ({ req, res }) => ({ req, res }),
      validationRules: process.env.NODE_ENV === 'production' 
        ? [depthLimit(8)]
        : [depthLimit(8)],
      introspection: process.env.NODE_ENV !== 'production',
      playground: process.env.NODE_ENV !== 'production',
    }),
    PrismaModule,
    AuthModule,
    FeedModule,
    HealthModule,
    MediaModule,
    ServiceOfferingsModule,
    StorageModule,
    ActivityModule,
    PlatformStatsModule,
    NetworkModule,
  ],
  providers: [
    {
      provide: APP_GUARD,
      useClass: GqlThrottlerGuard,
    },
  ],
})
export class AppModule {}
