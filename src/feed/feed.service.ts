import { BadRequestException, Injectable, Logger, Optional } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { ActivityService } from '../activity/activity.service';
import { MediaAssetStatus } from '../media/media.types';
import { CleanupService } from '../media/cleanup.service';
import { PrismaService } from '../prisma/prisma.service';
import { MediaUrlSigner } from '../storage/media-url-signer.interface';
import { StorageService } from '../storage/storage.service.interface';
import { interleavePosts } from './feed.interleave';
import { decodeFeedCursor, encodeFeedCursor } from './feed-cursor';
import { mapPostEdge } from './post-edge.mapper';
import { CreatePostData, CreateLegacyServiceData, PostsService } from './posts.service';
import { CreateProductData, ProductsService } from './products.service';
import { PlaybackService } from './playback.service';
import {
  FeedConnection,
  FeedInput,
  FeedTab,
  PlaybackResponse,
  PostContact,
  ProductConnection,
} from './feed.types';
import { Vertical } from '../common/vertical-assignment';

function isPrismaUniqueViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2002';
}

@Injectable()
export class FeedService {
  private readonly logger = new Logger(FeedService.name);
  private readonly postsOperations: PostsService;
  private readonly productOperations: ProductsService;
  private readonly playbackOperations: PlaybackService;

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly mediaUrlSigner: MediaUrlSigner,
    @Optional() private readonly activityService?: ActivityService,
    @Optional() private readonly cleanupService?: CleanupService,
    @Optional() postsService?: PostsService,
    @Optional() productsService?: ProductsService,
    @Optional() playbackService?: PlaybackService,
  ) {
    this.postsOperations =
      postsService ?? new PostsService(prisma, storage, activityService, cleanupService);
    this.productOperations =
      productsService ?? new ProductsService(prisma, storage, activityService);
    this.playbackOperations = playbackService ?? new PlaybackService(prisma, mediaUrlSigner);
  }

  encodeCursor(id: string, createdAt: Date): string {
    return encodeFeedCursor(id, createdAt);
  }

  decodeCursor(cursor: string): { id: string; createdAt: number } | null {
    return decodeFeedCursor(cursor);
  }

  async getFeed(input: FeedInput, viewerId?: string): Promise<FeedConnection> {
    const first = input.first ?? 10;
    const tab = input.tab ?? FeedTab.ALL;
    this.validatePageSize(first);
    this.logger.log(`Fetching feed userId=${viewerId ?? 'anonymous'} first=${first} tab=${tab}`);

    const where: Prisma.PostWhereInput = {};
    if (tab !== FeedTab.ALL) {
      where.vertical = tab;
    } else if (input.type) {
      where.type = input.type;
    }

    let cursorFilter: Prisma.PostWhereInput = {};
    if (input.after) {
      const decoded = this.decodeCursor(input.after);
      if (!decoded) {
        throw new BadRequestException('Invalid cursor provided');
      }
      const cursorDate = new Date(decoded.createdAt);
      cursorFilter = {
        OR: [{ createdAt: { lt: cursorDate } }, { createdAt: cursorDate, id: { lt: decoded.id } }],
      };
    }

    const mediaReadinessFilters: Prisma.PostWhereInput[] = [];
    if (viewerId) {
      mediaReadinessFilters.push({
        OR: [
          { authorId: viewerId },
          {
            AND: [{ mediaAssetId: null }, { offeringId: null }, { productId: null }],
          },
          {
            AND: [
              { mediaAssetId: { not: null } },
              { mediaAsset: { is: { status: MediaAssetStatus.READY } } },
            ],
          },
          {
            AND: [
              { offeringId: { not: null } },
              {
                offering: {
                  is: {
                    OR: [
                      { demoAssetId: null },
                      { demoAsset: { is: { status: MediaAssetStatus.READY } } },
                    ],
                  },
                },
              },
            ],
          },
          {
            AND: [
              { productId: { not: null } },
              {
                product: {
                  is: {
                    OR: [
                      { mediaAssetId: null },
                      { mediaAsset: { is: { status: MediaAssetStatus.READY } } },
                    ],
                  },
                },
              },
            ],
          },
        ],
      });
    } else {
      mediaReadinessFilters.push(
        {
          OR: [{ mediaAssetId: null }, { mediaAsset: { is: { status: MediaAssetStatus.READY } } }],
        },
        {
          OR: [
            { offeringId: null },
            {
              offering: {
                is: {
                  OR: [
                    { demoAssetId: null },
                    { demoAsset: { is: { status: MediaAssetStatus.READY } } },
                  ],
                },
              },
            },
          ],
        },
        {
          OR: [
            { productId: null },
            {
              product: {
                is: {
                  OR: [
                    { mediaAssetId: null },
                    { mediaAsset: { is: { status: MediaAssetStatus.READY } } },
                  ],
                },
              },
            },
          ],
        },
      );
    }

    const rejectionFilter: Prisma.PostWhereInput = {
      NOT: [
        { mediaAsset: { is: { status: MediaAssetStatus.REJECTED } } },
        {
          offering: {
            is: {
              demoAsset: { is: { status: MediaAssetStatus.REJECTED } },
            },
          },
        },
        {
          product: {
            is: {
              mediaAsset: { is: { status: MediaAssetStatus.REJECTED } },
            },
          },
        },
      ],
    };

    const posts = await this.prisma.post.findMany({
      where: {
        ...where,
        ...cursorFilter,
        AND: [...mediaReadinessFilters, rejectionFilter],
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
        service: {
          select: {
            id: true,
            name: true,
            description: true,
            category: true,
            location: true,
            price: true,
            availability: true,
            experience: true,
            mediaUrl: true,
            thumbnailUrl: true,
            mediaType: true,
            rating: true,
            reviews: true,
          },
        },
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: first + 1,
    });

    const hasNextPage = posts.length > first;
    let edges = hasNextPage ? posts.slice(0, first) : posts;
    const lastDbRow = edges[edges.length - 1];
    const endCursor = lastDbRow ? encodeFeedCursor(lastDbRow.id, lastDbRow.createdAt) : undefined;

    if (tab === FeedTab.ALL && edges.length > 2) {
      const interleaved = interleavePosts(
        edges.map((post) => ({
          id: post.id,
          vertical: post.vertical as Vertical,
          createdAt: post.createdAt,
        })),
      );
      const idToIndex = new Map(interleaved.map((post, index) => [post.id, index]));
      edges = edges.sort(
        (left, right) => (idToIndex.get(left.id) ?? 0) - (idToIndex.get(right.id) ?? 0),
      );
    }

    return {
      edges: edges.map((post) => mapPostEdge(post, viewerId ?? '', this.storage)),
      pageInfo: { hasNextPage, endCursor },
    };
  }

  async recordView(postId: string, userId: string): Promise<string> {
    let recorded = false;
    try {
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

          const mediaAssets = [
            post.mediaAsset,
            post.product?.mediaAsset,
            post.offering?.demoAsset,
          ].filter((asset): asset is NonNullable<typeof asset> => asset != null);
          const isAuthor = post.authorId === userId;
          const rejected = mediaAssets.some((asset) => asset.status === MediaAssetStatus.REJECTED);
          const visible =
            !rejected &&
            (isAuthor || mediaAssets.every((asset) => asset.status === MediaAssetStatus.READY));
          if (!visible) {
            this.logger.warn(`View ignored for invisible postId=${postId} userId=${userId}`);
            return;
          }
          if (isAuthor) {
            this.logger.log(`Author view ignored postId=${postId} userId=${userId}`);
            return;
          }

          await transaction.postView.create({ data: { postId, userId } });
          await transaction.post.update({
            where: { id: postId },
            data: { viewsCount: { increment: 1 } },
          });
          recorded = true;
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
    } catch (error: unknown) {
      if (!isPrismaUniqueViolation(error)) {
        throw error;
      }
      this.logger.log(`Duplicate view ignored postId=${postId} userId=${userId}`);
    }

    if (recorded) {
      this.logger.log(`Recorded view postId=${postId} userId=${userId}`);
      await this.activityService?.record('POST_VIEWED', userId, { postId });
    }
    return postId;
  }

  getMyPosts(first: number, after: string | undefined, userId: string): Promise<FeedConnection> {
    return this.postsOperations.getMyPosts(first, after, userId);
  }

  getProducts(
    viewerId: string,
    first = 10,
    after?: string,
    category?: string,
    sellerId?: string,
  ): Promise<ProductConnection> {
    return this.productOperations.getProducts(viewerId, first, after, category, sellerId);
  }

  createPost(data: CreatePostData) {
    return this.postsOperations.createPost(data);
  }

  createProduct(data: CreateProductData) {
    return this.productOperations.createProduct(data);
  }

  createService(data: CreateLegacyServiceData) {
    return this.postsOperations.createService(data);
  }

  deletePost(postId: string, userId: string): Promise<string> {
    return this.postsOperations.deletePost(postId, userId);
  }

  getPostContact(postId: string, userId: string): Promise<PostContact> {
    return this.playbackOperations.getPostContact(postId, userId);
  }

  getPlayback(postId: string): Promise<PlaybackResponse> {
    return this.playbackOperations.getPlayback(postId);
  }

  getPlaybacks(postIds: string[]): Promise<PlaybackResponse[]> {
    return this.playbackOperations.getPlaybacks(postIds);
  }

  private validatePageSize(first: number): void {
    if (!Number.isInteger(first) || first < 1 || first > 30) {
      throw new BadRequestException('first must be between 1 and 30');
    }
  }
}
