import { Controller, Get, Res } from '@nestjs/common';
import { Response } from 'express';
import { HealthService } from './health.service';

@Controller('health')
export class HealthController {
  constructor(private readonly healthService: HealthService) {}

  @Get()
  async check(@Res({ passthrough: true }) response: Response) {
    const result = await this.healthService.check();
    response.status(result.status === 'ok' ? 200 : 503);
    return result;
  }
}
