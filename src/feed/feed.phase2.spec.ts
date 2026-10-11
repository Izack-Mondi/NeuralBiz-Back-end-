import { UnauthorizedException } from '@nestjs/common';
import { FeedService } from './feed.service';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service.interface';
import { MediaUrlSigner } from '../storage/media-url-signer.interface';
import { CleanupService } from '../media/cleanup.service';
import { ActivityService } from '../activity/activity.service';
import { PostType } from './feed.types';

describe('FeedService Phase 2 operations', () => {
  let service: FeedService;
  let prisma: any;
  let transaction: any;
  let cleanupService: any;
  let activityService: any;

  beforeEach(() => {
    transaction = {
      product: { create: jest.fn().mockResolvedValue({ id: 'product-1' }) },
      post: {
        create: jest.fn().mockResolvedValue({ id: 'post-1' }),
        findUnique: jest.fn(),
        delete: jest.fn(),
      },
      mediaAsset: {
        findUnique: jest.fn(),
        deleteMany: jest.fn(),
      },
    };
    prisma = {
      product: { findUnique: jest.fn(), findMany: jest.fn() },
      post: { findMany: jest.fn() },
      mediaAsset: { findUnique: jest.fn() },
      $transaction: jest.fn((callback) => callback(transaction)),
    };
    cleanupService = { deleteMediaAssetObjects: jest.fn() };
    activityService = { record: jest.fn().mockResolvedValue(undefined) };
    service = new FeedService(
      prisma as PrismaService,
      { publicUrl: (key: string) => `https://cdn.example/${key}` } as StorageService,
      { createPlaybackUrl: jest.fn() } as unknown as MediaUrlSigner,
      activityService as ActivityService,
      cleanupService as CleanupService,
    );
  });

  it('creates a product and its feed post in one transaction by default', async () => {
    await service.createProduct({
      sellerId: 'seller-1',
      name: 'Maize',
      price: 80,
      unit: 'kg',
      category: 'crops',
    });

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(transaction.product.create).toHaveBeenCalledTimes(1);
    expect(transaction.post.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        authorId: 'seller-1',
        type: PostType.MARKETPLACE,
        productId: 'product-1',
      }),
    });
    expect(activityService.record).toHaveBeenCalledWith('PRODUCT_CREATED', 'seller-1', {
      productId: 'product-1',
    });
    expect(activityService.record).toHaveBeenCalledWith('POST_CREATED', 'seller-1', {
      postId: 'post-1',
    });
  });

  it('creates a product without a feed post when postToFeed is false', async () => {
    await service.createProduct({
      sellerId: 'seller-1',
      name: 'Maize',
      price: 80,
      unit: 'kg',
      category: 'crops',
      postToFeed: false,
    });

    expect(transaction.product.create).toHaveBeenCalledTimes(1);
    expect(transaction.post.create).not.toHaveBeenCalled();
  });

  it('rejects deletion when the caller does not own the post', async () => {
    transaction.post.findUnique.mockResolvedValue({
      id: 'post-1',
      authorId: 'seller-1',
      mediaAsset: null,
      product: null,
      offering: null,
    });

    await expect(service.deletePost('post-1', 'other-user')).rejects.toThrow(UnauthorizedException);
    expect(transaction.post.delete).not.toHaveBeenCalled();
    expect(cleanupService.deleteMediaAssetObjects).not.toHaveBeenCalled();
  });

  it('deletes exclusively attached media objects and rows with the post transaction', async () => {
    const asset = {
      id: 'asset-1',
      ownerId: 'seller-1',
      storageKey: 'video.mp4',
      hlsManifestKey: null,
      posterKey: null,
      previewKey: null,
    };
    transaction.post.findUnique.mockResolvedValue({
      id: 'post-1',
      authorId: 'seller-1',
      mediaAsset: asset,
      product: null,
      offering: null,
    });
    transaction.mediaAsset.findUnique.mockResolvedValue({
      _count: { posts: 1, products: 0, demoOfferings: 0 },
    });

    await service.deletePost('post-1', 'seller-1');

    expect(cleanupService.deleteMediaAssetObjects).toHaveBeenCalledWith(asset);
    expect(transaction.mediaAsset.deleteMany).toHaveBeenCalledWith({
      where: { id: { in: ['asset-1'] } },
    });
    expect(transaction.post.delete).toHaveBeenCalledWith({ where: { id: 'post-1' } });
  });

  it('returns all of the caller’s post statuses and rejection reasons', async () => {
    prisma.post.findMany.mockResolvedValue([
      {
        id: 'processing-post',
        authorId: 'seller-1',
        author: {
          id: 'seller-1',
          fullName: 'Seller',
          location: 'Nairobi',
          emailVerified: true,
          phoneVerified: true,
        },
        mediaAsset: { status: 'PROCESSING' },
        product: null,
        offering: null,
        service: null,
        createdAt: new Date('2026-01-03T00:00:00.000Z'),
        updatedAt: new Date('2026-01-03T00:00:00.000Z'),
      },
      {
        id: 'rejected-post',
        authorId: 'seller-1',
        author: {
          id: 'seller-1',
          fullName: 'Seller',
          location: 'Nairobi',
          emailVerified: true,
          phoneVerified: true,
        },
        mediaAsset: { status: 'REJECTED', rejectionReason: 'Duration limit exceeded' },
        product: null,
        offering: null,
        service: null,
        createdAt: new Date('2026-01-02T00:00:00.000Z'),
        updatedAt: new Date('2026-01-02T00:00:00.000Z'),
      },
      {
        id: 'published-post',
        authorId: 'seller-1',
        author: {
          id: 'seller-1',
          fullName: 'Seller',
          location: 'Nairobi',
          emailVerified: true,
          phoneVerified: true,
        },
        mediaAsset: null,
        product: null,
        offering: null,
        service: null,
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
        updatedAt: new Date('2026-01-01T00:00:00.000Z'),
      },
    ]);

    const result = await service.getMyPosts(10, undefined, 'seller-1');

    expect(result.edges.map(({ node }) => [node.status, node.rejectionReason])).toEqual([
      ['PROCESSING', undefined],
      ['REJECTED', 'Duration limit exceeded'],
      ['PUBLISHED', undefined],
    ]);
  });

  it('does not expose processing products to another seller', async () => {
    prisma.product.findMany.mockResolvedValue([]);

    await service.getProducts('viewer-1', 10, undefined, undefined, 'seller-2');

    const query = prisma.product.findMany.mock.calls[0][0];
    expect(query.where.sellerId).toBe('seller-2');
    expect(query.where.AND[0].OR).toEqual(
      expect.arrayContaining([
        { sellerId: 'viewer-1' },
        { mediaAssetId: null },
        { mediaAsset: { is: { status: 'READY' } } },
      ]),
    );
    expect(query.where.AND[0].OR).not.toContainEqual({ sellerId: 'seller-2' });
  });
});
