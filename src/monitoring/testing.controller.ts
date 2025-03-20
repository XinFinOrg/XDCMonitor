import { MetricsService } from '@metrics/metrics.service';
import { Controller, Get, Logger, Param, Post, Query } from '@nestjs/common';
import { AlertsService } from '@monitoring/alerts.service';
import { RpcMonitorService } from '@monitoring/rpc.monitor';

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

  @Get('simulate-apothem-blocktime')
  simulateApothemBlockTime(@Query('seconds') seconds: string = '4') {
    const blockTime = parseFloat(seconds);
    this.logger.log(`Simulating Apothem testnet block time: ${blockTime}s`);
    this.metricsService.setBlockTime(blockTime, 51);
    return { success: true, message: `Simulated Apothem testnet block time set to ${blockTime}s` };
  }

  @Post('simulate-rpc-down')
  simulateRpcDown(@Query('endpoint') endpoint: string) {
    if (!endpoint) {
      return { success: false, message: 'Endpoint parameter is required' };
    }

    this.logger.log(`Simulating RPC down: ${endpoint}`);
    this.metricsService.setRpcStatus(endpoint, false);

    return { success: true, message: `Simulated RPC down for ${endpoint}` };
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

  /**
   * Test All Alerts
   * This will trigger all the alerts we've implemented for quick testing
   */
  @Get('trigger-all-alerts')
  async triggerAllAlerts() {
    this.logger.log('Triggering all alert types for testing');

    // 1. Average Block Time Alert
    await this.alertsService.createThresholdAlert(
      'warning',
      'blockchain',
      'Average Block Time Exceeded Threshold',
      3.2,
      2.5,
      's',
    );

    // 2. Transaction Error Alert
    await this.alertsService.createThresholdAlert(
      'warning',
      'transactions',
      'High Transaction Error Rate',
      5,
      3,
      ' failed transactions in 5 minutes',
    );

    // 3. High Transaction Volume Alert
    await this.alertsService.createThresholdAlert(
      'info',
      'transactions',
      'High Transaction Volume',
      2500,
      2000,
      ' transactions in 5 minutes',
    );

    // 4. RPC Response Time Alert
    await this.alertsService.createThresholdAlert('error', 'rpc', 'RPC Response Time Excessive', 32000, 30000, 'ms');

    return {
      success: true,
      message: 'All test alerts triggered successfully',
      alerts: [
        { type: 'Average Block Time', threshold: '2.5s', value: '3.2s' },
        { type: 'Transaction Errors', threshold: '3 in 5 minutes', value: '5' },
        { type: 'Transaction Volume', threshold: '2000 in 5 minutes', value: '2500' },
        { type: 'RPC Response Time', threshold: '30000ms', value: '32000ms' },
      ],
    };
  }

  /**
   * Test specific alert type
   */
  @Get('trigger-alert/:type')
  async triggerSpecificAlert(@Param('type') alertType: string) {
    this.logger.log(`Triggering specific alert type: ${alertType}`);

    switch (alertType) {
      case 'block-time':
        await this.alertsService.createThresholdAlert(
          'warning',
          'blockchain',
          'Average Block Time Exceeded Threshold',
          3.2,
          2.5,
          's',
        );
        return { success: true, message: 'Block time alert triggered' };

      case 'tx-errors':
        await this.alertsService.createThresholdAlert(
          'warning',
          'transactions',
          'High Transaction Error Rate',
          5,
          3,
          ' failed transactions in 5 minutes',
        );
        return { success: true, message: 'Transaction errors alert triggered' };

      case 'tx-volume':
        await this.alertsService.createThresholdAlert(
          'info',
          'transactions',
          'High Transaction Volume',
          2500,
          2000,
          ' transactions in 5 minutes',
        );
        return { success: true, message: 'Transaction volume alert triggered' };

      case 'rpc-time':
        await this.alertsService.createThresholdAlert(
          'error',
          'rpc',
          'RPC Response Time Excessive',
          32000,
          30000,
          'ms',
        );
        return { success: true, message: 'RPC response time alert triggered' };

      default:
        return {
          success: false,
          message: 'Unknown alert type. Available types: block-time, tx-errors, tx-volume, rpc-time',
        };
    }
  }
}
