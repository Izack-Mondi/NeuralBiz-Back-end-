import { Injectable, OnModuleInit, OnModuleDestroy, Logger } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);

  constructor() {
    super({
      datasources: {
        db: {
          url: process.env.DATABASE_URL,
        },
      },
    });
  }

  async onModuleInit() {
    const maxAttempts = 4;

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        await this.$connect();
        this.logger.log('Successfully connected to the database');
        return;
      } catch {
        if (attempt === maxAttempts) {
          this.logger.error(`Database connection failed after ${maxAttempts} attempts.`);
          throw new Error(
            `Unable to connect to the database after ${maxAttempts} attempts. Check DATABASE_URL and PostgreSQL availability.`,
          );
        }

        const delayMs = attempt * 1000;
        this.logger.warn(
          `Database connection attempt ${attempt}/${maxAttempts} failed; retrying in ${delayMs}ms.`,
        );
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}
