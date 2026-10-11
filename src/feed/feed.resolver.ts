import { Resolver, Query, Args, Mutation, ID, Int } from '@nestjs/graphql';
import { UseGuards } from '@nestjs/common';
import { FeedService } from './feed.service';
import {
  FeedInput,
  FeedConnection,
  PostType,
  MediaType,
  PostContact,
  PlaybackResponse,
  ProductConnection,
  CreatePostInput,
  CreateProductInput,
  CreateServiceInput,
} from './feed.types';
import { GqlAuthGuard } from '../auth/gql-auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { Throttle } from '@nestjs/throttler';

@Resolver()
export class FeedResolver {
  constructor(private readonly feedService: FeedService) {}

  @Query(() => FeedConnection)
  @UseGuards(GqlAuthGuard)
  async homeFeed(
    @CurrentUser() user: any,
    @Args('input') input: FeedInput,
  ): Promise<FeedConnection> {
    return this.feedService.getFeed(input, user.sub);
  }

  @Query(() => ProductConnection)
  @UseGuards(GqlAuthGuard)
  async products(
    @CurrentUser() user: { sub: string },
    @Args('first', { type: () => Int, nullable: true, defaultValue: 10 }) first?: number,
    @Args('after', { nullable: true }) after?: string,
    @Args('category', { nullable: true }) category?: string,
    @Args('sellerId', { type: () => ID, nullable: true }) sellerId?: string,
  ): Promise<ProductConnection> {
    return this.feedService.getProducts(user.sub, first ?? 10, after, category, sellerId);
  }

  @Query(() => FeedConnection)
  @UseGuards(GqlAuthGuard)
  async myPosts(
    @CurrentUser() user: { sub: string },
    @Args('first', { type: () => Int, nullable: true, defaultValue: 10 }) first?: number,
    @Args('after', { nullable: true }) after?: string,
  ): Promise<FeedConnection> {
    return this.feedService.getMyPosts(first ?? 10, after, user.sub);
  }

  @Query(() => PostContact)
  @UseGuards(GqlAuthGuard)
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  async postContact(
    @CurrentUser() user: any,
    @Args('postId') postId: string,
  ): Promise<PostContact> {
    return this.feedService.getPostContact(postId, user.sub);
  }

  @Query(() => PlaybackResponse)
  @UseGuards(GqlAuthGuard)
  async playback(@Args('postId', { type: () => ID }) postId: string): Promise<PlaybackResponse> {
    return this.feedService.getPlayback(postId);
  }

  @Mutation(() => String, { deprecationReason: 'Use createPostWithInput.' })
  @UseGuards(GqlAuthGuard)
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  async createPost(
    @CurrentUser() user: any,
    @Args('type') type: PostType,
    @Args('caption', { nullable: true }) caption?: string,
    @Args('mediaUrl', { nullable: true }) mediaUrl?: string,
    @Args('thumbnailUrl', { nullable: true }) thumbnailUrl?: string,
    @Args('mediaType', { nullable: true }) mediaType?: MediaType,
    @Args('mediaAssetId', { nullable: true }) mediaAssetId?: string,
    @Args('productId', { nullable: true }) productId?: string,
    @Args('serviceId', { nullable: true }) serviceId?: string,
  ): Promise<string> {
    const post = await this.feedService.createPost({
      authorId: user.sub,
      type,
      caption,
      mediaUrl,
      thumbnailUrl,
      mediaType,
      mediaAssetId,
      productId,
      serviceId,
    });

    return post.id;
  }

  @Mutation(() => String)
  @UseGuards(GqlAuthGuard)
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  async createPostWithInput(
    @CurrentUser() user: { sub: string },
    @Args('input') input: CreatePostInput,
  ): Promise<string> {
    const post = await this.feedService.createPost({
      ...input,
      authorId: user.sub,
    });
    return post.id;
  }

  @Mutation(() => String, { deprecationReason: 'Use createProductWithInput.' })
  @UseGuards(GqlAuthGuard)
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  async createProduct(
    @CurrentUser() user: any,
    @Args('name') name: string,
    @Args('price') price: number,
    @Args('unit') unit: string,
    @Args('category') category: string,
    @Args('description', { nullable: true }) description?: string,
    @Args('location', { nullable: true }) location?: string,
    @Args('mediaUrl', { nullable: true }) mediaUrl?: string,
    @Args('thumbnailUrl', { nullable: true }) thumbnailUrl?: string,
    @Args('mediaType', { nullable: true }) mediaType?: MediaType,
    @Args('mediaAssetId', { nullable: true }) mediaAssetId?: string,
    @Args('postToFeed', { type: () => Boolean, nullable: true, defaultValue: true }) postToFeed = true,
  ): Promise<string> {
    const product = await this.feedService.createProduct({
      name,
      description,
      price,
      unit,
      category,
      location,
      mediaUrl,
      thumbnailUrl,
      mediaType,
      mediaAssetId,
      sellerId: user.sub,
      postToFeed,
    });

    return product.id;
  }

  @Mutation(() => String)
  @UseGuards(GqlAuthGuard)
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  async createProductWithInput(
    @CurrentUser() user: { sub: string },
    @Args('input') input: CreateProductInput,
  ): Promise<string> {
    const product = await this.feedService.createProduct({
      ...input,
      sellerId: user.sub,
    });
    return product.id;
  }

  @Mutation(() => String)
  @UseGuards(GqlAuthGuard)
  @Throttle({ default: { limit: 30, ttl: 60000 } })
  async recordView(
    @CurrentUser() user: any,
    @Args('postId', { type: () => ID }) postId: string,
  ): Promise<string> {
    return this.feedService.recordView(postId, user.sub);
  }

  @Query(() => [PlaybackResponse])
  @UseGuards(GqlAuthGuard)
  async playbacks(@Args('postIds', { type: () => [ID] }) postIds: string[]): Promise<PlaybackResponse[]> {
    if (postIds.length > 3) {
      throw new Error('Maximum 3 post IDs allowed for prefetching');
    }
    return this.feedService.getPlaybacks(postIds);
  }

  @Mutation(() => String, { deprecationReason: 'Use createServiceOffering instead.' })
  @UseGuards(GqlAuthGuard)
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  async createService(
    @CurrentUser() user: any,
    @Args('name') name: string,
    @Args('category') category: string,
    @Args('description', { nullable: true }) description?: string,
    @Args('location', { nullable: true }) location?: string,
    @Args('price', { nullable: true }) price?: string,
    @Args('availability', { nullable: true }) availability?: string,
    @Args('experience', { nullable: true }) experience?: string,
    @Args('mediaUrl', { nullable: true }) mediaUrl?: string,
    @Args('thumbnailUrl', { nullable: true }) thumbnailUrl?: string,
    @Args('mediaType', { nullable: true }) mediaType?: MediaType,
  ): Promise<string> {
    const service = await this.feedService.createService({
      name,
      description,
      category,
      location,
      price,
      availability,
      experience,
      mediaUrl,
      thumbnailUrl,
      mediaType,
      providerId: user.sub,
    });

    return service.id;
  }

  @Mutation(() => String, {
    deprecationReason: 'Use createServiceOffering instead; legacy services are not published to the feed.',
  })
  @UseGuards(GqlAuthGuard)
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  async createServiceWithInput(
    @CurrentUser() user: { sub: string },
    @Args('input') input: CreateServiceInput,
  ): Promise<string> {
    const service = await this.feedService.createService({
      ...input,
      providerId: user.sub,
    });
    return service.id;
  }

  @Mutation(() => ID)
  @UseGuards(GqlAuthGuard)
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  async deletePost(
    @CurrentUser() user: { sub: string },
    @Args('postId', { type: () => ID }) postId: string,
  ): Promise<string> {
    return this.feedService.deletePost(postId, user.sub);
  }
}