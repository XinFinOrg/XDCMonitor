import { MetricsService } from '@metrics/metrics.service';
import { Controller, Get, Header } from '@nestjs/common';

/**
 * Controller for regular /metrics endpoint (with api prefix applied by NestJS)
 */
@Controller('metrics')
export class MetricsController {
  constructor(private readonly metricsService: MetricsService) {}

  @Get()
  @Header('Content-Type', 'text/plain')
  async getMetrics(): Promise<string> {
    console.log('Metrics endpoint called');
    return this.metricsService.getMetrics();
  }
}
