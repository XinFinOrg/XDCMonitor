import { ENV_VARS } from '@common/constants/config';
import { ConfigService } from '@config/config.service';
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { SchedulerRegistry } from '@nestjs/schedule';
import axios from 'axios';
import { CronJob } from 'cron';

export interface HealthStatus {
  status: 'ok' | 'error';
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
export class HealthService implements OnModuleInit {
  private readonly logger = new Logger(HealthService.name);
  private startTime: number;

  // Healthchecks.io properties
  private readonly healthchecksUrl: string;
  private readonly pingInterval: number;

  constructor(
    private readonly configService: ConfigService,
    private readonly schedulerRegistry: SchedulerRegistry,
  ) {
    this.startTime = Date.now();

    // Initialize healthchecks.io integration
    const defaultUrl = 'https://hc-ping.com/907f929f-6dcd-4f43-af8e-66c2434081bd';
    this.healthchecksUrl = this.configService.get(ENV_VARS.HEALTHCHECKS_IO_URL, defaultUrl);
    this.pingInterval = this.configService.getNumber(ENV_VARS.HEALTHCHECKS_IO_INTERVAL, 1); // Interval in minutes

    this.logger.log(`Healthchecks.io integration enabled with URL: ${this.maskUrl(this.healthchecksUrl)}`);
    this.logger.log(`Ping interval set to ${this.pingInterval} minutes`);
  }

  /**
   * Set up the health check job on module initialization
   */
  onModuleInit() {
    debugger;
    if (!this.healthchecksUrl) {
      this.logger.warn('No healthchecks.io URL configured, health check pinging is disabled');
      return;
    }

    // Create a job that runs at the configured interval (in minutes)
    const job = new CronJob(`0 */${this.pingInterval} * * * *`, () => {
      this.pingHealthchecks();
    });

    this.schedulerRegistry.addCronJob('healthchecks-ping', job);
    job.start();

    this.logger.log(`Healthchecks.io ping job scheduled to run every ${this.pingInterval} minutes`);
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
      uptime,
      timestamp: new Date().toISOString(),
      environment,
    };
  }

  /**
   * Mask the healthchecks.io URL for logging (to avoid exposing the UUID)
   */
  private maskUrl(url: string): string {
    try {
      const parts = url.split('/');
      const uuid = parts[parts.length - 1];
      if (uuid && uuid.length > 8) {
        const maskedUuid = `${uuid.substring(0, 4)}...${uuid.substring(uuid.length - 4)}`;
        parts[parts.length - 1] = maskedUuid;
        return parts.join('/');
      }
      return url;
    } catch (error) {
      return url;
    }
  }

  /**
   * Ping the healthchecks.io endpoint to report system health
   * This is called automatically based on the configured interval
   */
  async pingHealthchecks(): Promise<void> {
    debugger;
    try {
      if (!this.healthchecksUrl) {
        return;
      }

      // Just fire and forget - we don't need to process the response
      await axios.get(this.healthchecksUrl, {
        timeout: 5000, // 5 second timeout
      });

      this.logger.debug(`Pinged healthchecks.io: ${this.maskUrl(this.healthchecksUrl)}`);
    } catch (error) {
      // Only log errors but don't handle them specially
      this.logger.error(`Failed to ping healthchecks.io: ${(error as Error).message}`);
    }
  }
}
