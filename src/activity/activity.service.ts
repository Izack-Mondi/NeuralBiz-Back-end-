import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class ActivityService {
  private readonly logger = new Logger(ActivityService.name);

  constructor(private readonly prisma: PrismaService) {}

  async record(
    type: string,
    userId: string | null,
    payload: Record<string, unknown> = {},
  ): Promise<void> {
    try {
      await this.prisma.$executeRaw`
        INSERT INTO "ActivityEvent" ("id", "userId", "type", "payload", "createdAt")
        VALUES (
          ${randomUUID()},
          ${userId},
          ${type},
          ${JSON.stringify(payload)}::jsonb,
          CURRENT_TIMESTAMP
        )
      `;
    } catch {
      this.logger.error(`Failed to record activity type=${type} userId=${userId ?? 'system'}`);
    }
  }
}
