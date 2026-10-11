import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { PrismaClient } from '@prisma/client';
import { FeedService } from '../src/feed/feed.service';
import { FeedTab } from '../src/feed/feed.types';
import { PrismaService } from '../src/prisma/prisma.service';
import { StorageService } from '../src/storage/storage.service.interface';
import { MediaUrlSigner } from '../src/storage/media-url-signer.interface';
import { ServiceOfferingsService } from '../src/service-offerings/service-offerings.service';
import { Vertical } from '../src/common/vertical-assignment';

const databaseUrl = process.env.DATABASE_URL_TEST;
const integrationDescribe = databaseUrl ? describe : describe.skip;

if (databaseUrl) {
  const { hostname } = new URL(databaseUrl);
  if (!['localhost', '127.0.0.1', '::1'].includes(hostname.toLowerCase())) {
    throw new Error('Integration tests are restricted to a local DATABASE_URL_TEST.');
  }
  execFileSync(process.execPath, [resolve(process.cwd(), 'scripts/assert-dev-db.js')], {
    env: { ...process.env, DATABASE_URL: databaseUrl },
    stdio: 'inherit',
  });
}

integrationDescribe('Home feed integration', () => {
  let prisma: PrismaClient | undefined;
  let feed: FeedService | undefined;
  let offerings: ServiceOfferingsService | undefined;
  const storage = {
    publicUrl: (key: string) => `https://media.example.test/${key}`,
  } as StorageService;
  const signer = {
    createPlaybackUrl: jest.fn(),
  } as unknown as MediaUrlSigner;
  const cleanupUserIds: string[] = [];

  function getPrisma(): PrismaClient {
    if (!prisma) {
      throw new Error('DATABASE_URL_TEST is required for integration tests');
    }
    return prisma;
  }

  function getFeed(): FeedService {
    if (!feed) {
      throw new Error('Integration test services are not initialized');
    }
    return feed;
  }

  function getOfferings(): ServiceOfferingsService {
    if (!offerings) {
      throw new Error('Integration test services are not initialized');
    }
    return offerings;
  }

  beforeAll(() => {
    if (!databaseUrl) {
      return;
    }
    prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
    feed = new FeedService(prisma as unknown as PrismaService, storage, signer);
    offerings = new ServiceOfferingsService(prisma as unknown as PrismaService, storage);
  });

  async function createUser(): Promise<string> {
    const user = await getPrisma().user.create({
      data: {
        fullName: 'Feed integration user',
        email: `${randomUUID()}@integration.test`,
        location: 'Nairobi',
        county: 'Nairobi',
        interests: ['business', 'agriculture'],
        status: 'ACTIVE',
        emailVerified: true,
        phoneVerified: true,
      },
    });
    cleanupUserIds.push(user.id);
    return user.id;
  }

  async function createVideoAsset(ownerId: string, status: 'READY' | 'PROCESSING' | 'REJECTED') {
    return getPrisma().mediaAsset.create({
      data: {
        ownerId,
        kind: 'VIDEO',
        status,
        rejectionReason: status === 'REJECTED' ? 'Video duration exceeds limit' : null,
        mimeType: 'video/mp4',
        sizeBytes: 1024,
        storageKey: `uploads/${ownerId}/${randomUUID()}.mp4`,
      },
    });
  }

  async function createOffering(providerId: string, title: string, demoAssetId?: string) {
    const result = await getOfferings().createServiceOffering(providerId, {
      title,
      category: 'agriculture services',
      description: title,
      skills: ['Farm production'],
      yearsExperience: 3,
      demoAssetId,
      vertical: Vertical.AGRICULTURE,
    });
    return result.offeringId;
  }

  afterEach(async () => {
    if (!prisma) {
      return;
    }
    for (const userId of cleanupUserIds.splice(0)) {
      await prisma.user.delete({ where: { id: userId } });
    }
  });

  afterAll(async () => {
    await prisma?.$disconnect();
  });

  it('publishes an offering with a READY demo asset to another user', async () => {
    const providerId = await createUser();
    const viewerId = await createUser();
    const asset = await createVideoAsset(providerId, 'READY');
    const offeringId = await createOffering(providerId, 'Ready demo service', asset.id);

    const result = await getFeed().getFeed({ first: 10 }, viewerId);

    expect(result.edges.some(({ node }) => node.offering?.id === offeringId)).toBe(true);
  });

  it('shows PROCESSING media only to its author and hides REJECTED media from everyone', async () => {
    const providerId = await createUser();
    const viewerId = await createUser();
    const processingAsset = await createVideoAsset(providerId, 'PROCESSING');
    const rejectedAsset = await createVideoAsset(providerId, 'REJECTED');
    const processingOfferingId = await createOffering(
      providerId,
      'Processing demo service',
      processingAsset.id,
    );
    const rejectedOfferingId = await createOffering(providerId, 'Rejected demo service');
    await getPrisma().serviceOffering.update({
      where: { id: rejectedOfferingId },
      data: { demoAssetId: rejectedAsset.id },
    });
    const rejectedPost = await getPrisma().post.findFirst({
      where: { offeringId: rejectedOfferingId },
      select: { id: true },
    });
    if (!rejectedPost) {
      throw new Error('Expected the rejected offering feed post to exist');
    }
    await getPrisma().post.update({
      where: { id: rejectedPost.id },
      data: { mediaAssetId: rejectedAsset.id },
    });

    const authorFeed = await getFeed().getFeed({ first: 20 }, providerId);
    const otherUserFeed = await getFeed().getFeed({ first: 20 }, viewerId);
    const authorIds = authorFeed.edges.map(({ node }) => node.offering?.id);
    const otherUserIds = otherUserFeed.edges.map(({ node }) => node.offering?.id);

    expect(authorIds).toContain(processingOfferingId);
    expect(otherUserIds).not.toContain(processingOfferingId);
    expect(authorIds).not.toContain(rejectedOfferingId);
    expect(otherUserIds).not.toContain(rejectedOfferingId);
  });

  it('paginates three pages without duplicate or missing posts', async () => {
    const authorId = await createUser();
    const baseTime = Date.now() + 24 * 60 * 60 * 1000;
    const posts = await Promise.all(
      Array.from({ length: 5 }, (_, index) =>
        getPrisma().post.create({
          data: {
            authorId,
            type: 'GENERAL',
            vertical: 'BUSINESS',
            caption: `Pagination post ${index}`,
            mediaType: 'TEXT',
            createdAt: new Date(baseTime + index * 1000),
          },
          select: { id: true },
        }),
      ),
    );
    const expectedIds = posts.map(({ id }) => id).reverse();

    const first = await getFeed().getFeed({ first: 2, tab: FeedTab.BUSINESS });
    if (!first.pageInfo.endCursor) {
      throw new Error('First pagination page did not return a cursor');
    }
    const second = await getFeed().getFeed({
      first: 2,
      tab: FeedTab.BUSINESS,
      after: first.pageInfo.endCursor,
    });
    if (!second.pageInfo.endCursor) {
      throw new Error('Second pagination page did not return a cursor');
    }
    const third = await getFeed().getFeed({
      first: 2,
      tab: FeedTab.BUSINESS,
      after: second.pageInfo.endCursor,
    });
    const pagedIds = [
      ...first.edges.map(({ node }) => node.id),
      ...second.edges.map(({ node }) => node.id),
      third.edges[0].node.id,
    ];

    expect(first.pageInfo.hasNextPage).toBe(true);
    expect(second.pageInfo.hasNextPage).toBe(true);
    expect(pagedIds).toEqual(expectedIds);
    expect(new Set(pagedIds).size).toBe(5);
  });
});
