import { MediaAssetKind, MediaAssetStatus } from '../media/media.types';
import { StorageService } from '../storage/storage.service.interface';
import { PostMedia } from './feed.types';
import type { MediaAsset as PrismaMediaAsset } from '@prisma/client';

type PostMediaAsset = Pick<
  PrismaMediaAsset,
  'kind' | 'status' | 'posterKey' | 'previewKey' | 'blurhash' | 'durationSec' | 'width' | 'height'
>;

export function toPostMedia(
  mediaAsset: PostMediaAsset | null | undefined,
  storage: StorageService,
): PostMedia | undefined {
  if (!mediaAsset || mediaAsset.status !== MediaAssetStatus.READY) {
    return undefined;
  }

  return {
    kind: mediaAsset.kind as MediaAssetKind,
    thumbnailUrl: mediaAsset.posterKey ? storage.publicUrl(mediaAsset.posterKey) : '',
    previewUrl: mediaAsset.previewKey ? storage.publicUrl(mediaAsset.previewKey) : '',
    blurhash: mediaAsset.blurhash || '',
    durationSec: mediaAsset.durationSec,
    width: mediaAsset.width,
    height: mediaAsset.height,
    hasVideo: mediaAsset.kind === MediaAssetKind.VIDEO,
  };
}
