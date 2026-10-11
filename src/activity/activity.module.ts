import { Global, Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { ActivityService } from './activity.service';

@Global()
@Module({
  imports: [PrismaModule],
  providers: [ActivityService],
  exports: [ActivityService],
})
export class ActivityModule {}
