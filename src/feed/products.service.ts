import { BadRequestException, Injectable, Logger, Optional } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { ActivityService } from '../activity/activity.service';
import { MediaAssetStatus } from '../media/media.types';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service.interface';
import { assignVertical } from '../common/vertical-assignment';
import { decodeFeedCursor, encodeFeedCursor } from './feed-cursor';
import { assertMediaAssetCanBeAttached } from './media-asset-ownership';
import { toPostMedia } from './post-media.mapper';
import { CreateProductInput, PostType, ProductConnection } from './feed.types';

export interface CreateProductData extends CreateProductInput {
  sellerId: string;
}

@Injectable()
export class ProductsService {
  private readonly logger = new Logger(ProductsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    @Optional() private readonly activityService?: ActivityService,
  ) {}

  async createProduct(data: CreateProductData) {
    if (data.mediaAssetId) {
      await assertMediaAssetCanBeAttached(this.prisma, data.sellerId, data.mediaAssetId);
    }

    const mediaType = data.mediaType || 'IMAGE';
    const postToFeed = data.postToFeed !== false;
    const { product, post } = await this.prisma.$transaction(async (transaction) => {
      const product = await transaction.product.create({
        data: {
          name: data.name,
          description: data.description,
          price: data.price,
          unit: data.unit,
          category: data.category,
          location: data.location,
          mediaUrl: data.mediaUrl,
          thumbnailUrl: data.thumbnailUrl,
          mediaType,
          mediaAssetId: data.mediaAssetId,
          sellerId: data.sellerId,
        },
      });
      const post = postToFeed
        ? await transaction.post.create({
            data: {
              authorId: data.sellerId,
              type: PostType.MARKETPLACE,
              vertical: assignVertical(PostType.MARKETPLACE, data.category),
              caption: data.description || data.name,
              mediaUrl: data.mediaUrl,
              thumbnailUrl: data.thumbnailUrl,
              mediaType,
              mediaAssetId: data.mediaAssetId,
              productId: product.id,
            },
          })
        : null;

      return { product, post };
    });

    this.logger.log(`Created productId=${product.id} userId=${data.sellerId}`);
    await this.activityService?.record('PRODUCT_CREATED', data.sellerId, { productId: product.id });
    if (post) {
      await this.activityService?.record('POST_CREATED', data.sellerId, { postId: post.id });
    }
    return product;
  }

  async getProducts(
    viewerId: string,
    first = 10,
    after?: string,
    category?: string,
    sellerId?: string,
  ): Promise<ProductConnection> {
    this.validatePageSize(first);
    const cursor = after ? decodeFeedCursor(after) : null;
    if (after && !cursor) {
      throw new BadRequestException('Invalid cursor provided');
    }

    const visibleMediaConditions: Prisma.ProductWhereInput[] = [
      { mediaAssetId: null },
      { mediaAsset: { is: { status: MediaAssetStatus.READY } } },
    ];
    const where: Prisma.ProductWhereInput = {
      ...(category && { category }),
      ...(sellerId && { sellerId }),
      AND: [
        {
          OR: [{ sellerId: viewerId }, ...visibleMediaConditions],
        },
        { NOT: { mediaAsset: { is: { status: MediaAssetStatus.REJECTED } } } },
        ...(cursor
          ? [
              {
                OR: [
                  { createdAt: { lt: new Date(cursor.createdAt) } },
                  { createdAt: new Date(cursor.createdAt), id: { lt: cursor.id } },
                ],
              },
            ]
          : []),
      ],
    };
    const products = await this.prisma.product.findMany({
      where,
      include: {
        seller: {
          select: {
            id: true,
            fullName: true,
            location: true,
            emailVerified: true,
            phoneVerified: true,
          },
        },
        mediaAsset: true,
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: first + 1,
    });

    const hasNextPage = products.length > first;
    const pageProducts = hasNextPage ? products.slice(0, first) : products;
    const lastProduct = pageProducts[pageProducts.length - 1];

    return {
      edges: pageProducts.map((product) => ({
        node: {
          id: product.id,
          name: product.name,
          description: product.description,
          price: product.price,
          unit: product.unit,
          category: product.category,
          location: product.location,
          seller: {
            id: product.seller.id,
            fullName: product.seller.fullName,
            location: product.seller.location,
            isVerified: product.seller.emailVerified && product.seller.phoneVerified,
          },
          media: toPostMedia(product.mediaAsset, this.storage),
          createdAt: product.createdAt,
        },
        cursor: encodeFeedCursor(product.id, product.createdAt),
      })),
      pageInfo: {
        hasNextPage,
        endCursor: lastProduct
          ? encodeFeedCursor(lastProduct.id, lastProduct.createdAt)
          : undefined,
      },
    };
  }

  private validatePageSize(first: number): void {
    if (!Number.isInteger(first) || first < 1 || first > 30) {
      throw new BadRequestException('first must be between 1 and 30');
    }
  }
}
