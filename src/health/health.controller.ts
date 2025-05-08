import { Controller, Get } from '@nestjs/common';
import { HealthService, HealthStatus } from './health.service';

@Controller('health')
export class HealthController {
  constructor(private readonly healthService: HealthService) {}

  /**
   * GET /api/health
   * Returns the health status of the application
   * Used by monitoring services like UptimeRobot to check if the application is running
   * 
   * @returns HealthStatus object with application status information
   * - status: 'ok' if the application is running properly
   * - version: current application version
   * - uptime: seconds since application start
   * - timestamp: current server time
   * - environment: current NODE_ENV
   */
  @Get()
  getHealth(): HealthStatus {
    return this.healthService.getHealth();
  }
}
