import { Inject, Injectable, Logger, OnApplicationShutdown, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Job, Worker } from 'bullmq';
import { VideoProcessingJob as VideoProcessor } from './video-processing.job';

@Injectable()
export class VideoProcessingWorker implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(VideoProcessingWorker.name);
  private worker?: Worker;

  constructor(
    private readonly configService: ConfigService,
    @Inject('VideoProcessingJob') private readonly videoProcessor: VideoProcessor,
  ) {}

  onModuleInit(): void {
    this.worker = new Worker(
      'video-processing',
      async (job: Job) => this.videoProcessor.process(job),
      {
        connection: {
          host: this.configService.get<string>('REDIS_HOST') || 'localhost',
          port: Number(this.configService.get<string>('REDIS_PORT') || 6379),
        },
        concurrency: 2,
      },
    );

    this.worker.on('completed', (job) => {
      this.logger.log(`Job ${job.id} completed`);
    });
    this.worker.on('failed', (job, error) => {
      this.logger.error(`Job ${job?.id} failed: ${error.message}`);
    });
    this.worker.on('error', (error) => {
      this.logger.error(`Worker connection failed: ${error.message}`);
    });

    this.logger.log('Video processing worker started');
  }

  async onApplicationShutdown(): Promise<void> {
    if (this.worker) {
      this.logger.log('Closing video processing worker');
      await this.worker.close();
    }
  }
}
