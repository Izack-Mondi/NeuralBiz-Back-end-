import { Module } from '@nestjs/common';
import { FeedResolver } from './feed.resolver';
import { FeedService } from './feed.service';
import { PrismaModule } from '../prisma/prisma.module';
import { AuthModule } from '../auth/auth.module';
import { StorageModule } from '../storage/storage.module';
import { MediaModule } from '../media/media.module';
import { ActivityModule } from '../activity/activity.module';
import { PostsService } from './posts.service';
import { ProductsService } from './products.service';
import { PlaybackService } from './playback.service';

@Module({
  imports: [PrismaModule, AuthModule, StorageModule, MediaModule, ActivityModule],
  providers: [FeedResolver, FeedService, PostsService, ProductsService, PlaybackService],
  exports: [FeedService, PostsService, ProductsService, PlaybackService],
})
export class FeedModule {}
