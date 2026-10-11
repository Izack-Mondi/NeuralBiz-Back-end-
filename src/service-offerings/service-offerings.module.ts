import { Module } from '@nestjs/common';
import { ServiceOfferingsResolver } from './service-offerings.resolver';
import { ServiceOfferingsService } from './service-offerings.service';
import { PrismaModule } from '../prisma/prisma.module';
import { MediaModule } from '../media/media.module';
import { AuthModule } from '../auth/auth.module';
import { StorageModule } from '../storage/storage.module';
import { ActivityModule } from '../activity/activity.module';

@Module({
  imports: [PrismaModule, MediaModule, AuthModule, StorageModule, ActivityModule],
  providers: [ServiceOfferingsResolver, ServiceOfferingsService],
  exports: [ServiceOfferingsService],
})
export class ServiceOfferingsModule {}
