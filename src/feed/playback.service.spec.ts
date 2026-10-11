import { BadRequestException, UnauthorizedException } from '@nestjs/common';
import { PlaybackService } from './playback.service';
import { PrismaService } from '../prisma/prisma.service';
import { MediaUrlSigner } from '../storage/media-url-signer.interface';

describe('PlaybackService', () => {
  let service: PlaybackService;
  let prisma: any;
  let signer: any;

  beforeEach(() => {
    prisma = {
      post: {
        findUnique: jest.fn(),
        findMany: jest.fn(),
      },
    };
    signer = {
      createPlaybackUrl: jest.fn().mockResolvedValue({
        url: 'https://media.example.test/manifest.m3u8',
        expiresAt: new Date('2026-01-01T01:00:00.000Z'),
      }),
    };
    service = new PlaybackService(prisma as unknown as PrismaService, signer as MediaUrlSigner);
  });

  it('requires an authenticated caller before returning contact details', async () => {
    await expect(service.getPostContact('post-1', '')).rejects.toThrow(UnauthorizedException);
    expect(prisma.post.findUnique).not.toHaveBeenCalled();
  });

  it.each(['PROCESSING', 'REJECTED'])(
    'does not return contact details for a %s media post, including to its author',
    async (status) => {
      prisma.post.findUnique.mockResolvedValue({
        id: 'post-1',
        authorId: 'user-1',
        author: {
          id: 'user-1',
          fullName: 'User',
          phoneNumber: '+254700000001',
          emailVerified: true,
          phoneVerified: true,
        },
        mediaAsset: { status },
        product: null,
        offering: null,
      });

      await expect(service.getPostContact('post-1', 'user-1')).rejects.toThrow(BadRequestException);
    },
  );

  it('does not return contact details when a related offering asset is not ready', async () => {
    prisma.post.findUnique.mockResolvedValue({
      id: 'post-1',
      authorId: 'author-1',
      author: {
        id: 'author-1',
        fullName: 'Author',
        phoneNumber: '+254700000001',
        emailVerified: true,
        phoneVerified: true,
      },
      mediaAsset: { status: 'READY' },
      product: null,
      offering: { demoAsset: { status: 'PROCESSING' } },
    });

    await expect(service.getPostContact('post-1', 'viewer-1')).rejects.toThrow(BadRequestException);
  });

  it('returns contact details only when a visible post author is verified', async () => {
    prisma.post.findUnique.mockResolvedValue({
      id: 'post-1',
      authorId: 'author-1',
      author: {
        id: 'author-1',
        fullName: 'Verified Author',
        phoneNumber: '+254700000001',
        emailVerified: true,
        phoneVerified: true,
      },
      mediaAsset: { status: 'READY' },
      product: null,
      offering: null,
    });

    await expect(service.getPostContact('post-1', 'viewer-1')).resolves.toEqual({
      id: 'author-1',
      fullName: 'Verified Author',
      phoneNumber: '+254700000001',
    });
  });

  it('returns a playback URL only for ready video assets', async () => {
    prisma.post.findUnique.mockResolvedValue({
      id: 'post-1',
      mediaAsset: {
        status: 'READY',
        kind: 'VIDEO',
        hlsManifestKey: 'media/asset-1/manifest.m3u8',
        durationSec: 12,
      },
      product: null,
      offering: null,
    });

    await expect(service.getPlayback('post-1')).resolves.toMatchObject({
      postId: 'post-1',
      hlsUrl: 'https://media.example.test/manifest.m3u8',
      durationSec: 12,
    });
    expect(signer.createPlaybackUrl).toHaveBeenCalledWith('media/asset-1/manifest.m3u8');
  });

  it('does not return playback when a related offering asset is rejected', async () => {
    prisma.post.findUnique.mockResolvedValue({
      id: 'post-1',
      mediaAsset: {
        status: 'READY',
        kind: 'VIDEO',
        hlsManifestKey: 'media/asset-1/manifest.m3u8',
      },
      product: null,
      offering: { demoAsset: { status: 'REJECTED' } },
    });

    await expect(service.getPlayback('post-1')).rejects.toThrow(BadRequestException);
    expect(signer.createPlaybackUrl).not.toHaveBeenCalled();
  });

  it('prefetches only ready video playback records', async () => {
    prisma.post.findMany.mockResolvedValue([
      {
        id: 'ready-post',
        mediaAsset: {
          status: 'READY',
          kind: 'VIDEO',
          hlsManifestKey: 'ready/manifest.m3u8',
          durationSec: 10,
        },
        product: null,
        offering: null,
      },
      {
        id: 'processing-post',
        mediaAsset: {
          status: 'PROCESSING',
          kind: 'VIDEO',
          hlsManifestKey: 'processing/manifest.m3u8',
          durationSec: 10,
        },
        product: null,
        offering: null,
      },
    ]);

    const result = await service.getPlaybacks(['ready-post', 'processing-post']);

    expect(result.map(({ postId }) => postId)).toEqual(['ready-post']);
    expect(signer.createPlaybackUrl).toHaveBeenCalledTimes(1);
  });
});
