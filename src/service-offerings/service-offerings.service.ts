import {
  Injectable,
  BadRequestException,
  UnauthorizedException,
  Logger,
  Optional,
  InternalServerErrorException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { MediaAssetKind, MediaAssetStatus } from '../media/media.types';
import {
  CreateServiceOfferingInput,
  ServiceOffering,
  ServiceOfferingConnection,
} from './service-offerings.types';
import { Vertical } from '../common/vertical-assignment';
import { KENYA_COUNTIES } from '../common/kenya-counties';
import { decodeFeedCursor, encodeFeedCursor } from '../feed/feed-cursor';
import { toPostMedia } from '../feed/post-media.mapper';
import { StorageService } from '../storage/storage.service.interface';
import { ActivityService } from '../activity/activity.service';

@Injectable()
export class ServiceOfferingsService {
  private readonly logger = new Logger(ServiceOfferingsService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly storage?: StorageService,
    @Optional() private readonly activityService?: ActivityService,
  ) {}

  async createServiceOffering(
    userId: string,
    input: CreateServiceOfferingInput,
  ): Promise<{ offeringId: string; postId: string }> {
    // Validate county
    if (input.county && !KENYA_COUNTIES.includes(input.county as any)) {
      throw new BadRequestException(`Invalid county. Must be one of: ${KENYA_COUNTIES.join(', ')}`);
    }

    // Validate vertical is BUSINESS or AGRICULTURE (not OPPORTUNITY)
    if (input.vertical === Vertical.OPPORTUNITY) {
      throw new BadRequestException(
        'Service offerings cannot use OPPORTUNITY vertical. Use BUSINESS or AGRICULTURE.',
      );
    }

    // Validate demo asset ownership if provided
    if (input.demoAssetId) {
      const asset = await this.prisma.mediaAsset.findUnique({
        where: { id: input.demoAssetId },
      });

      if (!asset) {
        throw new BadRequestException('Demo asset not found');
      }

      if (asset.ownerId !== userId) {
        throw new UnauthorizedException('You do not own this asset');
      }

      if (asset.kind !== MediaAssetKind.VIDEO) {
        throw new BadRequestException('Demo asset must be a video');
      }
      if (asset.status !== 'READY' && asset.status !== 'PROCESSING') {
        throw new BadRequestException('Demo asset must be processing or ready');
      }
    }

    // Use the user-chosen vertical explicitly
    const vertical = input.vertical;

    const result = await this.prisma.$transaction(async (transaction) => {
      const offering = await transaction.serviceOffering.create({
        data: {
          providerId: userId,
          title: input.title,
          category: input.category,
          description: input.description,
          skills: input.skills,
          yearsExperience: input.yearsExperience,
          startingPrice: input.startingPrice,
          priceUnit: input.priceUnit,
          county: input.county,
          demoAssetId: input.demoAssetId,
        },
      });

      const post = await transaction.post.create({
        data: {
          authorId: userId,
          type: 'GENERAL',
          vertical,
          caption: input.description || input.title,
          mediaAssetId: input.demoAssetId,
          offeringId: offering.id,
        },
      });

      return { offering, post };
    });

    this.logger.log(
      `Created offeringId=${result.offering.id} postId=${result.post.id} userId=${userId}`,
    );
    await this.activityService?.record('OFFERING_CREATED', userId, {
      offeringId: result.offering.id,
    });
    await this.activityService?.record('POST_CREATED', userId, { postId: result.post.id });

    return {
      offeringId: result.offering.id,
      postId: result.post.id,
    };
  }

  async getServiceOffering(offeringId: string): Promise<ServiceOffering> {
    const offering = await this.prisma.serviceOffering.findUnique({
      where: { id: offeringId },
      include: {
        demoAsset: true,
        provider: {
          select: {
            id: true,
            fullName: true,
            location: true,
            emailVerified: true,
            phoneVerified: true,
          },
        },
      },
    });

    if (!offering) {
      throw new BadRequestException('Service offering not found');
    }

    // Only show if demo asset is READY or null
    if (offering.demoAsset && offering.demoAsset.status !== MediaAssetStatus.READY) {
      throw new BadRequestException('Service offering is not ready yet');
    }

    return this.mapOffering(offering);
  }

  async listServiceOfferings(
    userId: string,
    first = 10,
    after?: string,
    category?: string,
    county?: string,
    providerId?: string,
  ): Promise<ServiceOfferingConnection> {
    if (!Number.isInteger(first) || first < 1 || first > 30) {
      throw new BadRequestException('first must be between 1 and 30');
    }
    const cursor = after ? decodeFeedCursor(after) : null;
    if (after && !cursor) {
      throw new BadRequestException('Invalid cursor provided');
    }

    const where: Prisma.ServiceOfferingWhereInput = {
      ...(category && { category }),
      ...(county && { county }),
      ...(providerId && { providerId }),
      AND: [
        {
          OR: [
            { providerId: userId },
            { demoAssetId: null },
            { demoAsset: { is: { status: MediaAssetStatus.READY } } },
          ],
        },
        { NOT: { demoAsset: { is: { status: MediaAssetStatus.REJECTED } } } },
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
    const offerings = await this.prisma.serviceOffering.findMany({
      where,
      include: {
        demoAsset: true,
        provider: {
          select: {
            id: true,
            fullName: true,
            location: true,
            emailVerified: true,
            phoneVerified: true,
          },
        },
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: first + 1,
    });
    const hasNextPage = offerings.length > first;
    const pageOfferings = hasNextPage ? offerings.slice(0, first) : offerings;
    const lastOffering = pageOfferings[pageOfferings.length - 1];

    return {
      edges: pageOfferings.map((offering) => ({
        node: this.mapOffering(offering),
        cursor: encodeFeedCursor(offering.id, offering.createdAt),
      })),
      pageInfo: {
        hasNextPage,
        endCursor: lastOffering
          ? encodeFeedCursor(lastOffering.id, lastOffering.createdAt)
          : undefined,
      },
    };
  }

  private mapOffering(offering: any): ServiceOffering {
    let media: ServiceOffering['media'];
    if (offering.demoAsset?.status === MediaAssetStatus.READY) {
      if (!this.storage) {
        throw new InternalServerErrorException('Storage service is unavailable');
      }
      media = toPostMedia(offering.demoAsset, this.storage);
    }

    return {
      ...offering,
      provider: {
        id: offering.provider.id,
        fullName: offering.provider.fullName,
        location: offering.provider.location,
        isVerified: offering.provider.emailVerified && offering.provider.phoneVerified,
      },
      media,
    };
  }
}
