import { Controller, Get, Query, Logger, Post } from '@nestjs/common';
import { MetricsService } from '@metrics/metrics.service';
import { AlertsService } from './alerts.service';
import { RpcMonitorService } from './rpc.monitor';

@Controller('testing')
export class TestingController {
  private readonly logger = new Logger(TestingController.name);

  constructor(
    private readonly metricsService: MetricsService,
    private readonly alertsService: AlertsService,
    private readonly rpcMonitorService: RpcMonitorService,
  ) {}

  @Get('simulate-slow-blocktime')
  simulateSlowBlockTime(@Query('seconds') seconds: string = '4') {
    const blockTime = parseFloat(seconds);
    this.logger.log(`Simulating slow block time: ${blockTime}s`);
    this.metricsService.setBlockTime(blockTime);
    return { success: true, message: `Simulated block time set to ${blockTime}s` };
  }

  @Post('simulate-rpc-down')
  simulateRpcDown(@Query('endpoint') endpoint: string) {
    if (!endpoint) {
      return { success: false, message: 'Endpoint parameter is required' };
    }

    this.logger.log(`Simulating RPC endpoint down: ${endpoint}`);
    this.metricsService.setRpcStatus(endpoint, false);

    return { success: true, message: `Simulated RPC endpoint ${endpoint} status set to down` };
  }

  @Post('simulate-rpc-latency')
  simulateRpcLatency(@Query('endpoint') endpoint: string, @Query('latency') latency: string = '500') {
    if (!endpoint) {
      return { success: false, message: 'Endpoint parameter is required' };
    }

    const latencyMs = parseInt(latency);
    this.logger.log(`Simulating high RPC latency: ${endpoint} - ${latencyMs}ms`);
    this.metricsService.recordRpcLatency(endpoint, latencyMs);

    return { success: true, message: `Simulated latency of ${latencyMs}ms for ${endpoint}` };
  }

  @Get('trigger-manual-alert')
  async triggerManualAlert(
    @Query('type') type: string = 'warning',
    @Query('title') title: string = 'Manual Test Alert',
    @Query('message') message: string = 'This is a manually triggered test alert',
  ) {
    const alertType = ['error', 'warning', 'info'].includes(type) ? (type as 'error' | 'warning' | 'info') : 'warning';

    this.logger.log(`Manually triggering ${alertType} alert: ${title}`);

    await this.alertsService.addAlert({
      type: alertType as 'error' | 'warning' | 'info',
      title,
      message,
      component: 'Testing',
    });

    return { success: true, message: `${alertType} alert triggered: ${title}` };
  }
}
