import { PrismaClient, Vertical } from '@prisma/client';

const prisma = new PrismaClient();
const SYSTEM_USER_ID = '00000000-0000-4000-8000-000000000001';

const opportunities = [
  {
    id: '00000000-0000-4000-8000-000000000101',
    vertical: Vertical.AGRICULTURE,
    caption:
      'OPPORTUNITY: Contract farming for 20 acres of green grams in Kitui. Buyers provide certified seed and agronomy support; harvest is purchased at an agreed market-linked price.',
  },
  {
    id: '00000000-0000-4000-8000-000000000102',
    vertical: Vertical.AGRICULTURE,
    caption:
      'OPPORTUNITY: Dairy cooperatives in Nyandarua can apply for a milk-cooling tank and collection partnership. Groups should have at least 30 active farmers and an operating bank account.',
  },
  {
    id: '00000000-0000-4000-8000-000000000103',
    vertical: Vertical.AGRICULTURE,
    caption:
      'OPPORTUNITY: Smallholder avocado farmers in Murang’a are invited to join an export-readiness programme covering grading, traceability and buyer introductions.',
  },
  {
    id: '00000000-0000-4000-8000-000000000104',
    vertical: Vertical.BUSINESS,
    caption:
      'OPPORTUNITY: Women-led businesses in Nairobi and Kiambu can apply for a KES 100,000–500,000 growth facility, with business coaching and six-month repayment terms.',
  },
  {
    id: '00000000-0000-4000-8000-000000000105',
    vertical: Vertical.BUSINESS,
    caption:
      'OPPORTUNITY: Kisumu-based youth enterprises are invited to pitch for market-access support, digital bookkeeping training and introductions to local retailers.',
  },
  {
    id: '00000000-0000-4000-8000-000000000106',
    vertical: Vertical.AGRICULTURE,
    caption:
      'OPPORTUNITY: Poultry groups in Uasin Gishu can register for a bulk-feed purchasing and veterinary support pilot. Priority goes to groups with a shared production plan.',
  },
];

async function main(): Promise<void> {
  await prisma.user.upsert({
    where: { id: SYSTEM_USER_ID },
    create: {
      id: SYSTEM_USER_ID,
      fullName: 'Nexify Opportunities',
      email: 'opportunities@nexify.example',
      location: 'Kenya',
      county: 'Nairobi',
      interests: ['agriculture', 'business'],
      status: 'ACTIVE',
      emailVerified: true,
      phoneVerified: false,
    },
    update: {
      fullName: 'Nexify Opportunities',
      email: 'opportunities@nexify.example',
      location: 'Kenya',
      county: 'Nairobi',
      interests: ['agriculture', 'business'],
      status: 'ACTIVE',
      emailVerified: true,
      phoneVerified: false,
    },
  });

  for (const opportunity of opportunities) {
    const data = {
      authorId: SYSTEM_USER_ID,
      type: 'OPPORTUNITY',
      vertical: opportunity.vertical,
      caption: opportunity.caption,
      mediaType: 'IMAGE',
    };
    await prisma.post.upsert({
      where: { id: opportunity.id },
      create: { id: opportunity.id, ...data },
      update: data,
    });
  }

  console.log(`Seeded ${opportunities.length} opportunity posts`);
}

main()
  .catch((error: unknown) => {
    console.error('Opportunity seed failed', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
