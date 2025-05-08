import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@config/config.service';
import { ENV_VARS } from '@common/constants/config';
import { version } from '../../package.json';

export interface HealthStatus {
  status: 'ok' | 'error';
  version: string;
  uptime: number;
  timestamp: string;
  environment: string;
  services?: {
    [key: string]: {
      status: 'ok' | 'error' | 'warning';
      details?: any;
    };
  };
}

@Injectable()
export class HealthService {
  private readonly logger = new Logger(HealthService.name);
  private startTime: number;

  constructor(private readonly configService: ConfigService) {
    this.startTime = Date.now();
  }

  /**
   * Get the health status of the application
   * @returns Health status object
   */
  getHealth(): HealthStatus {
    const uptime = Math.floor((Date.now() - this.startTime) / 1000);
    const environment = this.configService.get(ENV_VARS.NODE_ENV, 'development');

    return {
      status: 'ok',
      version,
      uptime,
      timestamp: new Date().toISOString(),
      environment,
    };
  }
}
