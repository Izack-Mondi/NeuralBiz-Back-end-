import { Job } from 'bullmq';
import { Logger } from '@nestjs/common';
import { MediaAssetKind, MediaAssetStatus } from '../media/media.types';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service.interface';
import { spawn } from 'child_process';
import { mkdir, mkdtemp, readdir, rm, writeFile } from 'fs/promises';
import * as path from 'path';
import { encode } from 'blurhash';
import sharp from 'sharp';

export interface VideoProcessingJobData {
  assetId: string;
}

interface VideoMetadata {
  duration: number;
  width: number;
  height: number;
  codec: string;
}

interface Rendition {
  height: number;
  width: number;
  bitrate: number;
}

class CommandExecutionError extends Error {
  constructor(
    message: string,
    readonly stderr: string,
  ) {
    super(message);
  }
}

export class VideoProcessingJob {
  private readonly logger = new Logger(VideoProcessingJob.name);
  private readonly maxDurationSec: number;
  private readonly processingTimeoutMs: number;
  private readonly tempDir: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly config: { get(key: string): string | number | undefined },
  ) {
    this.maxDurationSec = this.getConfigNumber('MAX_VIDEO_DURATION_SEC', 600);
    this.processingTimeoutMs = this.getConfigNumber('VIDEO_PROCESSING_TIMEOUT_MS', 15 * 60 * 1000);
    this.tempDir = String(this.config.get('TEMP_DIR') || './temp');
  }

  async process(job: Job<VideoProcessingJobData>): Promise<void> {
    const { assetId } = job.data;
    const asset = await this.prisma.mediaAsset.findUnique({ where: { id: assetId } });
    if (!asset) throw new Error(`Asset ${assetId} not found`);
    if (asset.kind !== MediaAssetKind.VIDEO) throw new Error(`Asset ${assetId} is not a video`);
    if (asset.status === MediaAssetStatus.READY || asset.status === MediaAssetStatus.REJECTED)
      return;
    if (asset.status !== MediaAssetStatus.PROCESSING) {
      throw new Error(`Asset ${assetId} is not in PROCESSING state`);
    }

    await mkdir(this.tempDir, { recursive: true });
    const jobTempDir = await mkdtemp(path.join(this.tempDir, `${assetId}-`));
    try {
      const videoPath = path.join(jobTempDir, 'input');
      await this.storage.getObjectToFile(asset.storageKey, videoPath);

      let metadata: VideoMetadata;
      try {
        metadata = await this.getVideoMetadata(videoPath);
      } catch (error) {
        const reason = this.getProbeRejectionReason(error);
        if (!reason) throw error;
        await this.rejectAsset(assetId, asset.storageKey, reason);
        return;
      }

      if (metadata.duration > this.maxDurationSec) {
        await this.rejectAsset(assetId, asset.storageKey, 'DURATION_EXCEEDS_LIMIT');
        return;
      }
      if (!this.isSupportedCodec(metadata.codec)) {
        await this.rejectAsset(assetId, asset.storageKey, 'UNSUPPORTED_CODEC');
        return;
      }

      const hlsDir = path.join(jobTempDir, 'hls');
      await mkdir(hlsDir, { recursive: true });
      const renditions = this.getRenditions(metadata);
      if (renditions.length === 0) {
        await this.rejectAsset(assetId, asset.storageKey, 'CORRUPT_FILE');
        return;
      }

      await this.transcodeToHls(videoPath, hlsDir, renditions);
      const posterPath = path.join(jobTempDir, 'poster.jpg');
      const previewPath = path.join(jobTempDir, 'preview.mp4');
      await this.generatePoster(videoPath, posterPath, metadata);
      await this.generatePreview(videoPath, previewPath, metadata);
      const blurhash = await this.generateBlurhash(posterPath);

      const storagePrefix = `media/${asset.id}`;
      const hlsManifestKey = `${storagePrefix}/master.m3u8`;
      const posterKey = `${storagePrefix}/poster.jpg`;
      const previewKey = `${storagePrefix}/preview.mp4`;
      for (const file of await readdir(hlsDir)) {
        const contentType = file.endsWith('.m3u8') ? 'application/vnd.apple.mpegurl' : 'video/mp2t';
        await this.storage.putObject(
          `${storagePrefix}/${file}`,
          path.join(hlsDir, file),
          contentType,
        );
      }
      await this.storage.putObject(posterKey, posterPath, 'image/jpeg');
      await this.storage.putObject(previewKey, previewPath, 'video/mp4');

      await this.prisma.mediaAsset.update({
        where: { id: assetId },
        data: {
          status: MediaAssetStatus.READY,
          durationSec: metadata.duration,
          width: metadata.width,
          height: metadata.height,
          hlsManifestKey,
          posterKey,
          previewKey,
          blurhash,
          rejectionReason: null,
        },
      });
      await this.storage.deleteObject(asset.storageKey);
      this.logger.log(`Processed video asset ${assetId}`);
    } catch (error) {
      const reason = this.getProcessingRejectionReason(error);
      if (reason) {
        await this.rejectAsset(assetId, asset.storageKey, reason);
        return;
      }
      this.logger.error(`Video processing attempt failed for ${assetId}: ${error}`);
      throw error;
    } finally {
      await rm(jobTempDir, { recursive: true, force: true });
    }
  }

  private async getVideoMetadata(videoPath: string): Promise<VideoMetadata> {
    const result = await this.runCommand('ffprobe', [
      '-v',
      'error',
      '-show_entries',
      'format=duration:stream=codec_type,codec_name,width,height',
      '-of',
      'json',
      videoPath,
    ]);
    const probe = JSON.parse(result.stdout) as {
      format?: { duration?: string };
      streams?: Array<{
        codec_type?: string;
        codec_name?: string;
        width?: number;
        height?: number;
      }>;
    };
    const videoStream = probe.streams?.find((stream) => stream.codec_type === 'video');
    if (!videoStream) throw new CommandExecutionError('No video stream', 'NO_VIDEO_STREAM');

    const duration = Number(probe.format?.duration);
    const width = Number(videoStream.width);
    const height = Number(videoStream.height);
    if (!Number.isFinite(duration) || duration <= 0 || width < 1 || height < 1) {
      throw new CommandExecutionError('Invalid video metadata', 'CORRUPT_FILE');
    }
    return { duration, width, height, codec: videoStream.codec_name || '' };
  }

  private getRenditions(metadata: VideoMetadata): Rendition[] {
    return [
      { height: 240, bitrate: 400_000 },
      { height: 480, bitrate: 1_200_000 },
      { height: 720, bitrate: 2_500_000 },
    ]
      .filter((rendition) => rendition.height <= metadata.height)
      .map((rendition) => ({
        ...rendition,
        width: Math.max(
          2,
          Math.floor((metadata.width * rendition.height) / metadata.height / 2) * 2,
        ),
      }));
  }

  private async transcodeToHls(
    inputPath: string,
    outputDir: string,
    renditions: Rendition[],
  ): Promise<void> {
    for (const rendition of renditions) {
      const name = `${rendition.height}p`;
      await this.runCommand('ffmpeg', [
        '-hide_banner',
        '-y',
        '-i',
        inputPath,
        '-map',
        '0:v:0',
        '-map',
        '0:a:0?',
        '-vf',
        `scale=${rendition.width}:${rendition.height}`,
        '-c:v',
        'libx264',
        '-preset',
        'veryfast',
        '-b:v',
        String(rendition.bitrate),
        '-maxrate',
        String(rendition.bitrate),
        '-bufsize',
        String(rendition.bitrate * 2),
        '-c:a',
        'aac',
        '-b:a',
        '128k',
        '-f',
        'hls',
        '-hls_time',
        '4',
        '-hls_playlist_type',
        'vod',
        '-hls_flags',
        'independent_segments',
        '-hls_segment_filename',
        path.join(outputDir, `${name}_%03d.ts`),
        path.join(outputDir, `${name}.m3u8`),
      ]);
    }

    const master = ['#EXTM3U', '#EXT-X-VERSION:3'];
    for (const rendition of renditions) {
      const bandwidth = Math.round(rendition.bitrate * 1.15 + 128_000);
      master.push(
        `#EXT-X-STREAM-INF:BANDWIDTH=${bandwidth},RESOLUTION=${rendition.width}x${rendition.height}`,
        `${rendition.height}p.m3u8`,
      );
    }
    await writeFile(path.join(outputDir, 'master.m3u8'), `${master.join('\n')}\n`);
  }

  private async generatePoster(
    inputPath: string,
    outputPath: string,
    metadata: VideoMetadata,
  ): Promise<void> {
    await this.runCommand('ffmpeg', [
      '-hide_banner',
      '-y',
      '-ss',
      '0',
      '-i',
      inputPath,
      '-frames:v',
      '1',
      '-vf',
      `scale=${Math.min(1280, metadata.width)}:-2`,
      '-q:v',
      '2',
      outputPath,
    ]);
  }

  private async generatePreview(
    inputPath: string,
    outputPath: string,
    metadata: VideoMetadata,
  ): Promise<void> {
    await this.runCommand('ffmpeg', [
      '-hide_banner',
      '-y',
      '-i',
      inputPath,
      '-t',
      String(Math.min(8, metadata.duration)),
      '-vf',
      `scale=-2:${Math.max(2, Math.floor(Math.min(480, metadata.height) / 2) * 2)}`,
      '-c:v',
      'libx264',
      '-preset',
      'veryfast',
      '-crf',
      '24',
      '-an',
      outputPath,
    ]);
  }

  private async generateBlurhash(imagePath: string): Promise<string> {
    const { data, info } = await sharp(imagePath)
      .resize(32, 32, { fit: 'inside' })
      .raw()
      .toBuffer({ resolveWithObject: true });
    return encode(new Uint8ClampedArray(data), info.width, info.height, 4, 4);
  }

  private async runCommand(
    command: string,
    args: string[],
  ): Promise<{ stdout: string; stderr: string }> {
    return new Promise((resolve, reject) => {
      const child = spawn(command, args, { windowsHide: true });
      let stdout = '';
      let stderr = '';
      let settled = false;
      const timeout = setTimeout(() => {
        child.kill('SIGKILL');
        if (!settled) {
          settled = true;
          reject(new Error(`${command} timed out after ${this.processingTimeoutMs}ms`));
        }
      }, this.processingTimeoutMs);

      child.stdout.on('data', (chunk: Buffer) => {
        stdout += chunk.toString();
      });
      child.stderr.on('data', (chunk: Buffer) => {
        stderr += chunk.toString();
      });
      child.on('error', (error) => {
        clearTimeout(timeout);
        if (!settled) {
          settled = true;
          reject(error);
        }
      });
      child.on('close', (code) => {
        clearTimeout(timeout);
        if (settled) return;
        settled = true;
        if (code === 0) resolve({ stdout, stderr });
        else reject(new CommandExecutionError(`${command} exited with ${code}`, stderr));
      });
    });
  }

  private getProbeRejectionReason(error: unknown): string | null {
    if (error instanceof CommandExecutionError && error.stderr === 'NO_VIDEO_STREAM')
      return 'NO_VIDEO_STREAM';
    if (
      error instanceof SyntaxError ||
      (error instanceof CommandExecutionError && error.stderr === 'CORRUPT_FILE')
    ) {
      return 'CORRUPT_FILE';
    }
    if (
      error instanceof CommandExecutionError &&
      /invalid data|moov atom not found|could not find codec parameters/i.test(error.stderr)
    ) {
      return 'CORRUPT_FILE';
    }
    return null;
  }

  private getProcessingRejectionReason(error: unknown): string | null {
    if (!(error instanceof CommandExecutionError)) return null;
    if (/unknown decoder|decoder .* not found|unsupported codec/i.test(error.stderr))
      return 'UNSUPPORTED_CODEC';
    if (/invalid data found|moov atom not found|error while decoding/i.test(error.stderr))
      return 'CORRUPT_FILE';
    return null;
  }

  private isSupportedCodec(codec: string): boolean {
    return new Set([
      'h264',
      'hevc',
      'mpeg4',
      'av1',
      'vp8',
      'vp9',
      'mjpeg',
      'prores',
      'h263',
      'mpeg1video',
      'mpeg2video',
      'theora',
      'wmv1',
      'wmv2',
      'vc1',
      'ffv1',
    ]).has(codec.toLowerCase());
  }

  private async rejectAsset(assetId: string, originalKey: string, reason: string): Promise<void> {
    await this.prisma.mediaAsset.update({
      where: { id: assetId },
      data: { status: MediaAssetStatus.REJECTED, rejectionReason: reason },
    });
    await this.storage.deleteObject(originalKey);
  }

  private getConfigNumber(key: string, defaultValue: number): number {
    const value = Number(this.config.get(key));
    return Number.isFinite(value) && value > 0 ? value : defaultValue;
  }
}
