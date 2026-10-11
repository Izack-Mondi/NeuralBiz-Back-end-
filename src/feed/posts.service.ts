import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  Logger,
  Optional,
  UnauthorizedException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { ActivityService } from '../activity/activity.service';
import { CleanupService } from '../media/cleanup.service';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service.interface';
import { assignVertical } from '../common/vertical-assignment';
import { decodeFeedCursor, encodeFeedCursor } from './feed-cursor';
import { assertMediaAssetCanBeAttached } from './media-asset-ownership';
import { mapPostEdge } from './post-edge.mapper';
import { CreateServiceInput, FeedConnection } from './feed.types';

export interface CreatePostData {
  authorId: string;
  type: string;
  caption?: string;
  mediaUrl?: string;
  thumbnailUrl?: string;
  mediaType?: string;
  mediaAssetId?: string;
  productId?: string;
  serviceId?: string;
}

export interface CreateLegacyServiceData extends CreateServiceInput {
  providerId: string;
}

@Injectable()
export class PostsService {
  private readonly logger = new Logger(PostsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    @Optional() private readonly activityService?: ActivityService,
    @Optional() private readonly cleanupService?: CleanupService,
  ) {}

  async createPost(data: CreatePostData) {
    if (data.mediaAssetId) {
      await assertMediaAssetCanBeAttached(this.prisma, data.authorId, data.mediaAssetId);
    }

    let productCategory: string | undefined;
    if (data.productId) {
      const product = await this.prisma.product.findUnique({
        where: { id: data.productId },
        select: { category: true, sellerId: true },
      });
      if (!product) {
        throw new BadRequestException('Product not found');
      }
      if (product.sellerId !== data.authorId) {
        throw new UnauthorizedException('You do not own this product');
      }
      productCategory = product.category;
    }

    let serviceCategory: string | undefined;
    if (data.serviceId) {
      const service = await this.prisma.service.findUnique({
        where: { id: data.serviceId },
        select: { category: true, providerId: true },
      });
      if (!service) {
        throw new BadRequestException('Service not found');
      }
      if (service.providerId !== data.authorId) {
        throw new UnauthorizedException('You do not own this service');
      }
      serviceCategory = service.category;
    }

    const post = await this.prisma.post.create({
      data: {
        authorId: data.authorId,
        type: data.type,
        vertical: assignVertical(data.type, productCategory, serviceCategory),
        caption: data.caption,
        mediaUrl: data.mediaUrl,
        thumbnailUrl: data.thumbnailUrl,
        mediaType: data.mediaType || 'IMAGE',
        mediaAssetId: data.mediaAssetId,
        productId: data.productId,
        serviceId: data.serviceId,
      },
      include: {
        author: true,
        product: true,
        service: true,
      },
    });
    this.logger.log(`Created postId=${post.id} userId=${data.authorId}`);
    await this.activityService?.record('POST_CREATED', data.authorId, { postId: post.id });
    return post;
  }

  async getMyPosts(
    first: number,
    after: string | undefined,
    userId: string,
  ): Promise<FeedConnection> {
    if (!userId) {
      throw new UnauthorizedException('Authentication is required');
    }
    this.validatePageSize(first);

    const cursor = after ? decodeFeedCursor(after) : null;
    if (after && !cursor) {
      throw new BadRequestException('Invalid cursor provided');
    }

    const posts = await this.prisma.post.findMany({
      where: {
        authorId: userId,
        ...(cursor && {
          OR: [
            { createdAt: { lt: new Date(cursor.createdAt) } },
            { createdAt: new Date(cursor.createdAt), id: { lt: cursor.id } },
          ],
        }),
      },
      include: {
        author: {
          select: {
            id: true,
            fullName: true,
            location: true,
            emailVerified: true,
            phoneVerified: true,
          },
        },
        mediaAsset: true,
        offering: { include: { demoAsset: true } },
        product: { include: { mediaAsset: true } },
        service: true,
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: first + 1,
    });

    const hasNextPage = posts.length > first;
    const pagePosts = hasNextPage ? posts.slice(0, first) : posts;
    const lastPost = pagePosts[pagePosts.length - 1];

    return {
      edges: pagePosts.map((post) => mapPostEdge(post, userId, this.storage)),
      pageInfo: {
        hasNextPage,
        endCursor: lastPost ? encodeFeedCursor(lastPost.id, lastPost.createdAt) : undefined,
      },
    };
  }

  async deletePost(postId: string, userId: string): Promise<string> {
    await this.prisma.$transaction(
      async (transaction) => {
        const post = await transaction.post.findUnique({
          where: { id: postId },
          include: {
            mediaAsset: true,
            product: { include: { mediaAsset: true } },
            offering: { include: { demoAsset: true } },
          },
        });

        if (!post) {
          throw new BadRequestException('Post not found');
        }
        if (post.authorId !== userId) {
          throw new UnauthorizedException('You do not own this post');
        }

        const referencedAssets = [
          post.mediaAsset,
          post.product?.mediaAsset,
          post.offering?.demoAsset,
        ].filter((asset): asset is NonNullable<typeof post.mediaAsset> => asset != null);
        const uniqueAssets = [
          ...new Map(referencedAssets.map((asset) => [asset.id, asset])).values(),
        ];
        const exclusivelyAttachedAssets: typeof uniqueAssets = [];

        for (const asset of uniqueAssets) {
          if (asset.ownerId !== userId) {
            continue;
          }
          const current = await transaction.mediaAsset.findUnique({
            where: { id: asset.id },
            select: {
              _count: {
                select: { posts: true, products: true, demoOfferings: true },
              },
            },
          });
          if (
            current &&
            current._count.posts === 1 &&
            current._count.products === 0 &&
            current._count.demoOfferings === 0
          ) {
            exclusivelyAttachedAssets.push(asset);
          }
        }

        if (exclusivelyAttachedAssets.length) {
          const cleanupService = this.cleanupService;
          if (!cleanupService) {
            throw new InternalServerErrorException('Media cleanup service is unavailable');
          }
          for (const asset of exclusivelyAttachedAssets) {
            this.logger.log(
              `Deleting media for postId=${postId} assetId=${asset.id} userId=${userId}`,
            );
            await cleanupService.deleteMediaAssetObjects(asset);
          }
        }

        await transaction.post.delete({ where: { id: postId } });
        if (exclusivelyAttachedAssets.length) {
          await transaction.mediaAsset.deleteMany({
            where: { id: { in: exclusivelyAttachedAssets.map((asset) => asset.id) } },
          });
        }
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );

    this.logger.log(`Deleted postId=${postId} userId=${userId}`);
    return postId;
  }

  async createService(data: CreateLegacyServiceData) {
    return this.prisma.service.create({
      data: {
        name: data.name,
        description: data.description,
        category: data.category,
        location: data.location,
        price: data.price,
        availability: data.availability,
        experience: data.experience,
        mediaUrl: data.mediaUrl,
        thumbnailUrl: data.thumbnailUrl,
        mediaType: data.mediaType || 'IMAGE',
        providerId: data.providerId,
      },
    });
  }

  private validatePageSize(first: number): void {
    if (!Number.isInteger(first) || first < 1 || first > 30) {
      throw new BadRequestException('first must be between 1 and 30');
    }
  }
}
