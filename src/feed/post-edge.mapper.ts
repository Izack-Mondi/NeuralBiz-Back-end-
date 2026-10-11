import { MediaAssetStatus } from '../media/media.types';
import { StorageService } from '../storage/storage.service.interface';
import { PostEdge, PostServiceOffering, PostStatus } from './feed.types';
import { encodeFeedCursor } from './feed-cursor';
import { toPostMedia } from './post-media.mapper';

export function computePostStatus(post: any, viewerId?: string): PostStatus {
  if (viewerId && post.authorId === viewerId) {
    const mediaAsset = post.mediaAsset ?? post.product?.mediaAsset ?? post.offering?.demoAsset;
    if (mediaAsset?.status === MediaAssetStatus.REJECTED) {
      return PostStatus.REJECTED;
    }
    if (mediaAsset && mediaAsset.status !== MediaAssetStatus.READY) {
      return PostStatus.PROCESSING;
    }
  }

  return PostStatus.PUBLISHED;
}

export function mapPostEdge(post: any, viewerId: string, storage: StorageService): PostEdge {
  const mediaAsset = post.mediaAsset ?? post.product?.mediaAsset ?? post.offering?.demoAsset;
  const offering: PostServiceOffering | undefined = post.offering
    ? {
        id: post.offering.id,
        title: post.offering.title,
        category: post.offering.category,
        description: post.offering.description,
        skills: post.offering.skills,
        yearsExperience: post.offering.yearsExperience,
        startingPrice: post.offering.startingPrice,
        priceUnit: post.offering.priceUnit,
        county: post.offering.county,
      }
    : undefined;

  return {
    node: {
      id: post.id,
      author: {
        id: post.author.id,
        fullName: post.author.fullName,
        location: post.author.location,
        isVerified: post.author.emailVerified && post.author.phoneVerified,
      },
      type: post.type,
      vertical: post.vertical,
      caption: post.caption,
      mediaUrl: post.mediaType === 'VIDEO' ? undefined : post.mediaUrl,
      thumbnailUrl: post.thumbnailUrl,
      mediaType: post.mediaType,
      media: toPostMedia(mediaAsset, storage),
      offering,
      product: post.product
        ? {
            ...post.product,
            mediaUrl: post.product.mediaType === 'VIDEO' ? undefined : post.product.mediaUrl,
            mediaType: post.product.mediaType,
          }
        : undefined,
      service: post.service,
      status: computePostStatus(post, viewerId),
      rejectionReason:
        mediaAsset?.status === MediaAssetStatus.REJECTED ? mediaAsset.rejectionReason : undefined,
      likesCount: post.likesCount,
      commentsCount: post.commentsCount,
      viewsCount: post.viewsCount,
      createdAt: post.createdAt,
      updatedAt: post.updatedAt,
    },
    cursor: encodeFeedCursor(post.id, post.createdAt),
  };
}
