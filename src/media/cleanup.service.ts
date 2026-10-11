import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service.interface';
import { MediaAssetStatus } from './media.types';
import type { MediaAsset } from '@prisma/client';

@Injectable()
export class CleanupService {
  private readonly logger = new Logger(CleanupService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {}

  async deleteMediaAssetObjects(
    asset: Pick<MediaAsset, 'id' | 'storageKey' | 'hlsManifestKey' | 'posterKey' | 'previewKey'>,
  ): Promise<void> {
    const keys = new Set(
      [asset.storageKey, asset.hlsManifestKey, asset.posterKey, asset.previewKey].filter(
        (key): key is string => Boolean(key),
      ),
    );

    for (const key of keys) {
      try {
        await this.storage.deleteObject(key);
      } catch {
        this.logger.error(`Failed to delete media object assetId=${asset.id}`);
        throw new Error(`Could not delete storage object for asset ${asset.id}`);
      }
    }
  }

  @Cron(CronExpression.EVERY_HOUR)
  async cleanupStuckUploads() {
    this.logger.log('Starting stuck upload cleanup');

    const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);

    const stuckAssets = await this.prisma.mediaAsset.findMany({
      where: {
        status: MediaAssetStatus.UPLOADING,
        createdAt: {
          lt: twentyFourHoursAgo,
        },
      },
    });

    this.logger.log(`Found ${stuckAssets.length} stuck uploads`);

    for (const asset of stuckAssets) {
      try {
        await this.deleteMediaAssetObjects(asset);

        // Delete from database
        await this.prisma.mediaAsset.delete({
          where: { id: asset.id },
        });

        this.logger.log(`Cleaned up assetId=${asset.id} userId=${asset.ownerId}`);
      } catch {
        this.logger.error(`Failed to clean up assetId=${asset.id} userId=${asset.ownerId}`);
      }
    }

    this.logger.log('Stuck upload cleanup completed');
  }
}
