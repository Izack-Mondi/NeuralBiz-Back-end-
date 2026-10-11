import { BadRequestException, Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { MediaAssetKind, MediaAssetStatus } from '../media/media.types';
import { PrismaService } from '../prisma/prisma.service';
import { MediaUrlSigner } from '../storage/media-url-signer.interface';
import { PlaybackResponse, PostContact } from './feed.types';

@Injectable()
export class PlaybackService {
  private readonly logger = new Logger(PlaybackService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly mediaUrlSigner: MediaUrlSigner,
  ) {}

  async getPostContact(postId: string, userId: string): Promise<PostContact> {
    if (!userId) {
      throw new UnauthorizedException('Authentication is required');
    }

    const post = await this.prisma.post.findUnique({
      where: { id: postId },
      include: {
        author: {
          select: {
            id: true,
            fullName: true,
            phoneNumber: true,
            emailVerified: true,
            phoneVerified: true,
          },
        },
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
    if (mediaAssets.some((asset) => asset.status !== MediaAssetStatus.READY)) {
      this.logger.warn(`Contact denied for invisible postId=${postId} userId=${userId}`);
      throw new BadRequestException('Post is not visible');
    }
    if (!post.author.emailVerified || !post.author.phoneVerified) {
      throw new BadRequestException('Author is not verified');
    }

    this.logger.log(`Post contact accessed postId=${postId} userId=${userId}`);
    return {
      id: post.author.id,
      fullName: post.author.fullName,
      phoneNumber: post.author.phoneNumber,
    };
  }

  async getPlayback(postId: string): Promise<PlaybackResponse> {
    const post = await this.prisma.post.findUnique({
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
    if (mediaAssets.some((asset) => asset.status !== MediaAssetStatus.READY)) {
      throw new BadRequestException('Media asset is not ready');
    }
    const mediaAsset = post.mediaAsset ?? post.product?.mediaAsset ?? post.offering?.demoAsset;
    if (!mediaAsset) {
      throw new BadRequestException('Post has no media asset');
    }
    if (mediaAsset.status !== MediaAssetStatus.READY) {
      throw new BadRequestException('Media asset is not ready');
    }
    if (mediaAsset.kind !== MediaAssetKind.VIDEO || !mediaAsset.hlsManifestKey) {
      throw new BadRequestException('HLS manifest not available');
    }

    const { url, expiresAt } = await this.mediaUrlSigner.createPlaybackUrl(
      mediaAsset.hlsManifestKey,
    );
    return {
      postId,
      hlsUrl: url,
      durationSec: mediaAsset.durationSec || 0,
      expiresAt,
    };
  }

  async getPlaybacks(postIds: string[]): Promise<PlaybackResponse[]> {
    const posts = await this.prisma.post.findMany({
      where: { id: { in: postIds } },
      include: {
        mediaAsset: true,
        product: { include: { mediaAsset: true } },
        offering: { include: { demoAsset: true } },
      },
    });
    const responses: PlaybackResponse[] = [];

    for (const post of posts) {
      const mediaAssets = [
        post.mediaAsset,
        post.product?.mediaAsset,
        post.offering?.demoAsset,
      ].filter((asset): asset is NonNullable<typeof asset> => asset != null);
      if (mediaAssets.some((asset) => asset.status !== MediaAssetStatus.READY)) {
        continue;
      }
      const mediaAsset = post.mediaAsset ?? post.product?.mediaAsset ?? post.offering?.demoAsset;
      if (
        !mediaAsset ||
        mediaAsset.status !== MediaAssetStatus.READY ||
        mediaAsset.kind !== MediaAssetKind.VIDEO ||
        !mediaAsset.hlsManifestKey
      ) {
        continue;
      }

      const { url, expiresAt } = await this.mediaUrlSigner.createPlaybackUrl(
        mediaAsset.hlsManifestKey,
      );
      responses.push({
        postId: post.id,
        hlsUrl: url,
        durationSec: mediaAsset.durationSec || 0,
        expiresAt,
      });
    }

    return responses;
  }
}
