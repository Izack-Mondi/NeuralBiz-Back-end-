import { BadRequestException, UnauthorizedException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export async function assertMediaAssetCanBeAttached(
  prisma: PrismaService,
  userId: string,
  assetId: string,
): Promise<void> {
  const asset = await prisma.mediaAsset.findUnique({ where: { id: assetId } });
  if (!asset) {
    throw new BadRequestException('Media asset not found');
  }
  if (asset.ownerId !== userId) {
    throw new UnauthorizedException('You do not own this media asset');
  }
  if (asset.status !== 'READY' && asset.status !== 'PROCESSING') {
    throw new BadRequestException('Media asset must be processing or ready');
  }
}
