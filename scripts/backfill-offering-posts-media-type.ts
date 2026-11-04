import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function backfillOfferingPostsMediaType() {
  console.log('Starting backfill of offering posts mediaType...');

  // Check if columns exist
  try {
    const testPost = await prisma.post.findFirst({
      select: { id: true, offeringId: true, mediaAssetId: true },
    });
    console.log('Columns check passed:', testPost ? 'posts exist' : 'no posts');
  } catch (error: any) {
    console.error('Column check failed:', error.message);
    console.log('Backfill cannot proceed - required columns missing from database');
    return;
  }

  // Find all posts that have an offeringId and a video media asset
  const posts = await prisma.post.findMany({
    where: {
      offeringId: { not: null },
      mediaAssetId: { not: null },
      mediaType: 'IMAGE', // These are the ones that need fixing
    },
    include: {
      mediaAsset: true,
    },
  });

  console.log(`Found ${posts.length} offering posts to check...`);

  let updated = 0;
  for (const post of posts) {
    if (post.mediaAsset?.kind === 'VIDEO') {
      await prisma.post.update({
        where: { id: post.id },
        data: { mediaType: 'VIDEO' },
      });
      updated++;
      console.log(`Updated post ${post.id} to VIDEO`);
    }
  }

  console.log(`Backfill complete. Updated ${updated} posts.`);
}

backfillOfferingPostsMediaType()
  .catch((error) => {
    console.error('Backfill failed:', error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
