import { FeedService } from './feed.service';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service.interface';
import { MediaUrlSigner } from '../storage/media-url-signer.interface';
import { BadRequestException } from '@nestjs/common';

describe('FeedService recordView', () => {
  let feedService: FeedService;
  let prisma: any;

  beforeEach(() => {
    prisma = {
      post: {
        findUnique: jest.fn(),
        update: jest.fn(),
      },
      postView: {
        create: jest.fn(),
      },
      $transaction: jest.fn(async (callback) => {
        return callback(prisma);
      }),
    };
    const storage = { publicUrl: (key: string) => `https://cdn.example/${key}` };
    const signer = { createPlaybackUrl: jest.fn() };
    feedService = new FeedService(
      prisma as PrismaService,
      storage as unknown as StorageService,
      signer as unknown as MediaUrlSigner,
    );
  });

  it('records a new view and increments viewsCount', async () => {
    prisma.post.findUnique.mockResolvedValue({
      id: 'post-1',
      authorId: 'user-2',
      viewsCount: 5,
      author: { id: 'user-2', emailVerified: true, phoneVerified: true },
      mediaAsset: null,
      product: null,
      offering: null,
    });
    prisma.postView.create.mockResolvedValue({
      id: 'view-1',
      postId: 'post-1',
      userId: 'user-1',
    });
    prisma.post.update.mockResolvedValue({
      id: 'post-1',
      viewsCount: 6,
    });

    const result = await feedService.recordView('post-1', 'user-1');

    expect(result).toBe('post-1');
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(prisma.postView.create).toHaveBeenCalledWith({
      data: {
        postId: 'post-1',
        userId: 'user-1',
      },
    });
    expect(prisma.post.update).toHaveBeenCalledWith({
      where: { id: 'post-1' },
      data: {
        viewsCount: {
          increment: 1,
        },
      },
    });
  });

  it('is idempotent - does not increment if user already viewed', async () => {
    prisma.post.findUnique.mockResolvedValue({
      id: 'post-1',
      authorId: 'user-2',
      viewsCount: 5,
      author: { id: 'user-2', emailVerified: true, phoneVerified: true },
      mediaAsset: null,
      product: null,
      offering: null,
    });
    prisma.postView.create.mockRejectedValue({ code: 'P2002' });
    prisma.post.update.mockResolvedValue({
      id: 'post-1',
      viewsCount: 5,
    });

    const result = await feedService.recordView('post-1', 'user-1');

    expect(result).toBe('post-1');
    expect(prisma.postView.create).toHaveBeenCalled();
    expect(prisma.post.update).not.toHaveBeenCalled();
  });

  it('throws BadRequestException if post does not exist', async () => {
    prisma.post.findUnique.mockResolvedValue(null);

    await expect(feedService.recordView('post-1', 'user-1')).rejects.toThrow(BadRequestException);
    expect(prisma.postView.create).not.toHaveBeenCalled();
    expect(prisma.post.update).not.toHaveBeenCalled();
  });

  it("skips view recording for author's own posts", async () => {
    prisma.post.findUnique.mockResolvedValue({
      id: 'post-1',
      authorId: 'user-1',
      viewsCount: 5,
      author: { id: 'user-1', emailVerified: true, phoneVerified: true },
      mediaAsset: null,
      product: null,
      offering: null,
    });

    const result = await feedService.recordView('post-1', 'user-1');

    expect(result).toBe('post-1');
    expect(prisma.postView.create).not.toHaveBeenCalled();
    expect(prisma.post.update).not.toHaveBeenCalled();
  });

  it('skips view recording for posts not visible to user', async () => {
    prisma.post.findUnique.mockResolvedValue({
      id: 'post-1',
      authorId: 'user-2',
      viewsCount: 5,
      author: { id: 'user-2', emailVerified: true, phoneVerified: true },
      mediaAsset: { status: 'PROCESSING' },
      product: null,
      offering: null,
    });

    const result = await feedService.recordView('post-1', 'user-1');

    expect(result).toBe('post-1');
    expect(prisma.postView.create).not.toHaveBeenCalled();
    expect(prisma.post.update).not.toHaveBeenCalled();
  });

  it('does not record views for rejected media, including the author', async () => {
    prisma.post.findUnique.mockResolvedValue({
      id: 'post-1',
      authorId: 'user-1',
      mediaAsset: { status: 'REJECTED' },
      product: null,
      offering: null,
    });

    await feedService.recordView('post-1', 'user-1');

    expect(prisma.postView.create).not.toHaveBeenCalled();
    expect(prisma.post.update).not.toHaveBeenCalled();
  });

  it('does not record views when a related offering asset is rejected', async () => {
    prisma.post.findUnique.mockResolvedValue({
      id: 'post-1',
      authorId: 'user-2',
      mediaAsset: { status: 'READY' },
      product: null,
      offering: { demoAsset: { status: 'REJECTED' } },
    });

    await feedService.recordView('post-1', 'user-1');

    expect(prisma.postView.create).not.toHaveBeenCalled();
    expect(prisma.post.update).not.toHaveBeenCalled();
  });

  it('rethrows non-P2002 errors', async () => {
    prisma.post.findUnique.mockResolvedValue({
      id: 'post-1',
      authorId: 'user-2',
      viewsCount: 5,
      author: { id: 'user-2', emailVerified: true, phoneVerified: true },
      mediaAsset: null,
      product: null,
      offering: null,
    });
    prisma.postView.create.mockRejectedValue(new Error('Some other error'));

    await expect(feedService.recordView('post-1', 'user-1')).rejects.toThrow(Error);
  });
});
