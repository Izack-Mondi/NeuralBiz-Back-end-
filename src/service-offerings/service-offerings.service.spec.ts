import { UnauthorizedException, BadRequestException } from '@nestjs/common';
import { ServiceOfferingsService } from './service-offerings.service';
import { PrismaService } from '../prisma/prisma.service';
import { Vertical } from '../common/vertical-assignment';

describe('ServiceOfferingsService', () => {
  let service: ServiceOfferingsService;
  let prisma: any;
  let transaction: any;

  beforeEach(() => {
    transaction = {
      serviceOffering: { create: jest.fn().mockResolvedValue({ id: 'offering-1' }) },
      post: { create: jest.fn().mockResolvedValue({ id: 'post-1' }) },
    };
    prisma = {
      mediaAsset: { findUnique: jest.fn() },
      serviceOffering: { findMany: jest.fn() },
      $transaction: jest.fn((callback) => callback(transaction)),
    };
    service = new ServiceOfferingsService(prisma as PrismaService);
  });

  it('creates an agriculture service offering and its feed post atomically with user-chosen vertical', async () => {
    const result = await service.createServiceOffering('provider-1', {
      title: 'Irrigation installation',
      category: 'irrigation',
      skills: ['Drip systems'],
      yearsExperience: 4,
      county: 'Nairobi',
      vertical: Vertical.AGRICULTURE,
    });

    expect(result).toEqual({ offeringId: 'offering-1', postId: 'post-1' });
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(transaction.post.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ vertical: Vertical.AGRICULTURE, offeringId: 'offering-1' }),
    });
  });

  it('creates a business service offering with user-chosen vertical', async () => {
    const result = await service.createServiceOffering('provider-1', {
      title: 'Web development',
      category: 'web development',
      skills: ['React', 'Node.js'],
      yearsExperience: 5,
      vertical: Vertical.BUSINESS,
    });

    expect(result).toEqual({ offeringId: 'offering-1', postId: 'post-1' });
    expect(transaction.post.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ vertical: Vertical.BUSINESS, offeringId: 'offering-1' }),
    });
  });

  it('rejects OPPORTUNITY vertical for service offerings', async () => {
    await expect(
      service.createServiceOffering('provider-1', {
        title: 'Job opportunity',
        category: 'jobs',
        skills: [],
        yearsExperience: 0,
        vertical: Vertical.OPPORTUNITY,
      }),
    ).rejects.toThrow(BadRequestException);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('rejects a demo asset owned by another user', async () => {
    prisma.mediaAsset.findUnique.mockResolvedValue({
      id: 'asset-1',
      ownerId: 'user-a',
      kind: 'VIDEO',
      status: 'READY',
    });

    await expect(
      service.createServiceOffering('user-b', {
        title: 'Photography',
        category: 'photography',
        skills: [],
        yearsExperience: 0,
        demoAssetId: 'asset-1',
        vertical: Vertical.BUSINESS,
      }),
    ).rejects.toThrow(UnauthorizedException);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('allows a processing video asset and creates a post that remains feed-hidden', async () => {
    prisma.mediaAsset.findUnique.mockResolvedValue({
      id: 'asset-1',
      ownerId: 'provider-1',
      kind: 'VIDEO',
      status: 'PROCESSING',
    });

    await service.createServiceOffering('provider-1', {
      title: 'Photography',
      category: 'photography',
      skills: [],
      yearsExperience: 2,
      demoAssetId: 'asset-1',
      vertical: Vertical.BUSINESS,
    });

    expect(transaction.post.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ mediaAssetId: 'asset-1', vertical: Vertical.BUSINESS }),
    });
  });

  it('lists cursor-paginated offerings with provider summaries', async () => {
    const createdAt = new Date('2026-01-01T00:00:00.000Z');
    prisma.serviceOffering.findMany.mockResolvedValue([
      {
        id: 'offering-1',
        title: 'Irrigation installation',
        category: 'irrigation',
        skills: ['Drip systems'],
        yearsExperience: 4,
        county: 'Nairobi',
        demoAsset: null,
        provider: {
          id: 'provider-1',
          fullName: 'Provider',
          location: 'Nairobi',
          emailVerified: true,
          phoneVerified: true,
        },
        createdAt,
      },
    ]);

    const result = await service.listServiceOfferings('viewer-1');

    expect(result.edges).toHaveLength(1);
    expect(result.edges[0].node.provider).toEqual({
      id: 'provider-1',
      fullName: 'Provider',
      location: 'Nairobi',
      isVerified: true,
    });
    expect(prisma.serviceOffering.findMany.mock.calls[0][0].orderBy).toEqual([
      { createdAt: 'desc' },
      { id: 'desc' },
    ]);
  });
});
