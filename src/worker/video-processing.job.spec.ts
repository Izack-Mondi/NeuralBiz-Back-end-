import { spawnSync } from 'child_process';
import { copyFile, mkdtemp, rm, writeFile } from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { VideoProcessingJob } from './video-processing.job';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service.interface';

const ffmpegAvailable =
  spawnSync('ffmpeg', ['-version'], { windowsHide: true }).status === 0 &&
  spawnSync('ffprobe', ['-version'], { windowsHide: true }).status === 0;

describe('VideoProcessingJob duration enforcement', () => {
  const integrationTest = ffmpegAvailable ? it : it.skip;

  integrationTest(
    'rejects a 601-second video and deletes the original',
    async () => {
      await runFixture(601, async ({ asset, prisma, storage, worker }) => {
        await worker.process({ data: { assetId: asset.id } } as any);
        expect(prisma.mediaAsset.update).toHaveBeenCalledWith(
          expect.objectContaining({
            data: expect.objectContaining({
              status: 'REJECTED',
              rejectionReason: 'DURATION_EXCEEDS_LIMIT',
            }),
          }),
        );
        expect(storage.deleteObject).toHaveBeenCalledWith(asset.storageKey);
      });
    },
    180_000,
  );

  integrationTest(
    'rejects any duration above the configured 600-second maximum',
    async () => {
      await runFixture(1, async ({ asset, prisma, storage, worker }) => {
        jest.spyOn(worker as any, 'getVideoMetadata').mockResolvedValue({
          duration: 600.5,
          width: 1280,
          height: 720,
          codec: 'h264',
        });
        await worker.process({ data: { assetId: asset.id } } as any);
        expect(prisma.mediaAsset.update).toHaveBeenCalledWith(
          expect.objectContaining({
            data: expect.objectContaining({
              status: 'REJECTED',
              rejectionReason: 'DURATION_EXCEEDS_LIMIT',
            }),
          }),
        );
        expect(storage.deleteObject).toHaveBeenCalledWith(asset.storageKey);
      });
    },
    180_000,
  );

  integrationTest(
    'marks a 599-second video READY with HLS renditions and poster',
    async () => {
      await runFixture(599, async ({ asset, prisma, storage, worker }) => {
        await worker.process({ data: { assetId: asset.id } } as any);
        expect(prisma.mediaAsset.update).toHaveBeenCalledWith(
          expect.objectContaining({
            data: expect.objectContaining({
              status: 'READY',
              hlsManifestKey: `media/${asset.id}/master.m3u8`,
              posterKey: `media/${asset.id}/poster.jpg`,
              previewKey: `media/${asset.id}/preview.mp4`,
            }),
          }),
        );
        expect(storage.putObject.mock.calls.map((call: any[]) => call[0])).toEqual(
          expect.arrayContaining([
            `media/${asset.id}/master.m3u8`,
            `media/${asset.id}/240p.m3u8`,
            `media/${asset.id}/480p.m3u8`,
            `media/${asset.id}/720p.m3u8`,
            `media/${asset.id}/poster.jpg`,
          ]),
        );
      });
    },
    300_000,
  );
});

async function runFixture(
  durationSec: number,
  assertion: (context: {
    asset: { id: string; storageKey: string };
    prisma: any;
    storage: any;
    worker: VideoProcessingJob;
  }) => Promise<void>,
): Promise<void> {
  const root = await mkdtemp(path.join(os.tmpdir(), 'nexify-video-test-'));
  const inputPath = path.join(root, 'fixture.mp4');
  const result = spawnSync(
    'ffmpeg',
    [
      '-hide_banner',
      '-loglevel',
      'error',
      '-y',
      '-f',
      'lavfi',
      '-i',
      'color=c=blue:s=1280x720:r=1',
      '-t',
      String(durationSec),
      '-c:v',
      'libx264',
      '-preset',
      'ultrafast',
      '-pix_fmt',
      'yuv420p',
      inputPath,
    ],
    { windowsHide: true },
  );
  if (result.status !== 0) {
    await rm(root, { recursive: true, force: true });
    throw new Error(`Could not generate ffmpeg fixture: ${result.stderr.toString()}`);
  }

  const asset = {
    id: `asset-${durationSec}`,
    kind: 'VIDEO',
    status: 'PROCESSING',
    storageKey: `uploads/asset-${durationSec}/source.mp4`,
  };
  const prisma = {
    mediaAsset: {
      findUnique: jest.fn().mockResolvedValue(asset),
      update: jest.fn().mockResolvedValue({ ...asset, status: 'READY' }),
    },
  };
  const storage = {
    getObjectToFile: jest.fn((_key: string, destination: string) =>
      copyFile(inputPath, destination),
    ),
    putObject: jest.fn(async (_key: string, source: string) => {
      await writeFile(path.join(root, path.basename(source) + '.uploaded'), 'uploaded');
    }),
    deleteObject: jest.fn().mockResolvedValue(undefined),
  };
  const worker = new VideoProcessingJob(
    prisma as unknown as PrismaService,
    storage as unknown as StorageService,
    {
      get: (key: string) =>
        (
          ({
            MAX_VIDEO_DURATION_SEC: 600,
            TEMP_DIR: root,
            VIDEO_PROCESSING_TIMEOUT_MS: 120_000,
          }) as any
        )[key],
    },
  );

  try {
    await assertion({ asset, prisma, storage, worker });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}
