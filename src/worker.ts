import { NestFactory } from '@nestjs/core';
import { WorkerModule } from './worker/worker.module';
import { Logger } from '@nestjs/common';

async function bootstrap() {
  const app = await NestFactory.createApplicationContext(WorkerModule);
  app.enableShutdownHooks();
}

bootstrap().catch((error: unknown) => {
  const logger = new Logger('Worker');
  logger.error(
    `Worker startup failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
  );
  process.exitCode = 1;
});
