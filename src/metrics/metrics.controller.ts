import { Controller, Get, Header } from '@nestjs/common';
import { MetricsService } from './metrics.service';

/**
 * Controller for metrics endpoint.
 * Note: This endpoint is maintained for backward compatibility, but won't serve metrics
 * since we've migrated to InfluxDB push model instead of Prometheus pull model.
 */
@Controller('metrics')
export class MetricsController {
  constructor(private readonly metricsService: MetricsService) {}

  @Get()
  @Header('Content-Type', 'text/plain')
  async getMetrics(): Promise<string> {
    // This now returns an empty string as metrics are pushed to InfluxDB directly
    return this.metricsService.getMetrics();
  }
}
