import { Module, OnModuleInit } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { AuthResolver } from './auth.resolver';
import { AuthService } from './auth.service';
import { AuthGuard } from './auth.guard';
import { GqlAuthGuard } from './gql-auth.guard';
import { PrismaModule } from '../prisma/prisma.module';
import { EmailModule } from '../email/email.module';
import { SmsModule } from '../sms/sms.module';
import { GqlThrottlerGuard } from '../common/gql-throttler.guard';
import { ActivityModule } from '../activity/activity.module';

@Module({
  imports: [
    PrismaModule,
    EmailModule,
    SmsModule,
    ActivityModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      useFactory: async (configService: ConfigService) => {
        const secret = configService.get<string>('JWT_SECRET');
        if (!secret) {
          throw new Error('JWT_SECRET environment variable is required');
        }
        return {
          secret,
          signOptions: {
            expiresIn: configService.get('JWT_EXPIRES_IN') || '15m',
          },
        };
      },
      inject: [ConfigService],
    }),
  ],
  providers: [AuthResolver, AuthService, AuthGuard, GqlAuthGuard, GqlThrottlerGuard],
  exports: [AuthGuard, GqlAuthGuard, GqlThrottlerGuard, JwtModule],
})
export class AuthModule implements OnModuleInit {
  constructor(private readonly configService: ConfigService) {}

  onModuleInit() {
    const jwtSecret = this.configService.get<string>('JWT_SECRET');
    if (!jwtSecret) {
      throw new Error('JWT_SECRET environment variable is required');
    }
  }
}
