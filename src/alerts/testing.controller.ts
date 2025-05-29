import { MetricsService } from '@metrics/metrics.service';
import { Controller, Get, Logger, Param, Post, Query } from '@nestjs/common';
import { AlertService } from './alert.service';
import { RpcMonitorService } from '@monitoring/rpc/rpc.monitor';
import { ConfigService } from '@config/config.service';

@Controller('testing')
export class TestingController {
  private readonly logger = new Logger(TestingController.name);

  constructor(
    private readonly metricsService: MetricsService,
    private readonly alertService: AlertService,
    private readonly rpcMonitorService: RpcMonitorService,
    private readonly configService: ConfigService,
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
    this.metricsService.setRpcStatusWithSentinel(endpoint, false, 50, true);

    return { success: true, message: `Simulated RPC down for ${endpoint}` };
  }

  @Post('simulate-rpc-latency')
  simulateRpcLatency(@Query('endpoint') endpoint: string, @Query('latency') latency: string = '500') {
    if (!endpoint) {
      return { success: false, message: 'Endpoint parameter is required' };
    }

    const latencyMs = parseInt(latency);
    this.logger.log(`Simulating high RPC latency: ${endpoint} - ${latencyMs}ms`);
    this.metricsService.recordRpcLatencyWithSentinel(endpoint, latencyMs, 50, false);

    return { success: true, message: `Simulated latency of ${latencyMs}ms for ${endpoint}` };
  }

  @Get('trigger-manual-alert')
  async triggerManualAlert(
    @Query('type') type: string = 'warning',
    @Query('title') title: string = 'Manual Test Alert',
    @Query('message') message: string = 'This is a manually triggered test alert',
    @Query('chainId') chainIdStr: string = '',
  ) {
    const alertType = ['error', 'warning', 'info'].includes(type) ? (type as 'error' | 'warning' | 'info') : 'warning';
    const chainId = chainIdStr ? parseInt(chainIdStr) : undefined;

    this.logger.log(`Manually triggering ${alertType} alert: ${title}${chainId ? ` for chain ID ${chainId}` : ''}`);

    await this.alertService.addAlert(
      {
        type: alertType as 'error' | 'warning' | 'info',
        title,
        message,
        component: 'Testing',
      },
      chainId,
    );

    return {
      success: true,
      message: `${alertType} alert triggered: ${title}${chainId ? ` for chain ID ${chainId}` : ''}`,
    };
  }

  /**
   * Test All Alerts
   * This will trigger all the alerts we've implemented for quick testing
   */
  @Get('trigger-all-alerts')
  async triggerAllAlerts() {
    this.logger.log('Triggering all alert types for testing');

    // 1. Average Block Time Alert
    await this.alertService.createThresholdAlert(
      'warning',
      'blockchain',
      'Average Block Time Exceeded Threshold',
      3.2,
      2.5,
      's',
    );

    // 2. Transaction Error Alert
    await this.alertService.createThresholdAlert(
      'warning',
      'transactions',
      'High Transaction Error Rate',
      5,
      3,
      ' failed transactions in 5 minutes',
    );

    // 3. High Transaction Volume Alert
    await this.alertService.createThresholdAlert(
      'info',
      'transactions',
      'High Transaction Volume',
      2500,
      2000,
      ' transactions in 5 minutes',
    );

    // 4. RPC Response Time Alert
    await this.alertService.createThresholdAlert('error', 'rpc', 'RPC Response Time Excessive', 32000, 30000, 'ms');

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
        await this.alertService.createThresholdAlert(
          'warning',
          'blockchain',
          'Average Block Time Exceeded Threshold',
          3.2,
          2.5,
          's',
        );
        return { success: true, message: 'Block time alert triggered' };

      case 'tx-errors':
        await this.alertService.createThresholdAlert(
          'warning',
          'transactions',
          'High Transaction Error Rate',
          5,
          3,
          ' failed transactions in 5 minutes',
        );
        return { success: true, message: 'Transaction errors alert triggered' };

      case 'tx-volume':
        await this.alertService.createThresholdAlert(
          'info',
          'transactions',
          'High Transaction Volume',
          2500,
          2000,
          ' transactions in 5 minutes',
        );
        return { success: true, message: 'Transaction volume alert triggered' };

      case 'rpc-time':
        await this.alertService.createThresholdAlert('error', 'rpc', 'RPC Response Time Excessive', 32000, 30000, 'ms');
        return { success: true, message: 'RPC response time alert triggered' };

      default:
        return {
          success: false,
          message: 'Unknown alert type. Available types: block-time, tx-errors, tx-volume, rpc-time',
        };
    }
  }

  /**
   * Test Telegram topics functionality
   * Sends alerts to both Mainnet and Testnet topics
   */
  @Get('test-telegram-topics')
  async testTelegramTopics() {
    this.logger.log('Testing Telegram topics for Mainnet and Testnet alerts');

    // Send a Mainnet alert (chain ID 50)
    await this.alertService.addAlert(
      {
        type: 'info',
        title: 'Mainnet Test Alert',
        message: 'This alert should appear in the Mainnet topic',
        component: 'Testing',
      },
      50,
    ); // Mainnet chain ID

    // Send a Testnet alert (chain ID 51)
    await this.alertService.addAlert(
      {
        type: 'info',
        title: 'Testnet Test Alert',
        message: 'This alert should appear in the Testnet topic',
        component: 'Testing',
      },
      51,
    ); // Testnet chain ID

    // Send a general alert (no specific chain)
    await this.alertService.addAlert({
      type: 'info',
      title: 'General Test Alert',
      message: 'This alert should appear in the main thread (no topic)',
      component: 'Testing',
    });

    return {
      success: true,
      message: 'Test alerts sent to Mainnet topic, Testnet topic, and main thread',
      details: [
        { chainId: 50, title: 'Mainnet Test Alert' },
        { chainId: 51, title: 'Testnet Test Alert' },
        { chainId: undefined, title: 'General Test Alert' },
      ],
    };
  }

  /**
   * Manually generate a weekly report
   * Allows getting a report for a custom date range
   */
  @Get('generate-weekly-report')
  async generateWeeklyReport(
    @Query('startDays') startDaysAgo: string = '7',
    @Query('endDays') endDaysAgo: string = '0',
  ) {
    this.logger.log('Manually generating weekly report');

    const now = new Date();
    const startDate = new Date(now.getTime() - parseInt(startDaysAgo) * 24 * 60 * 60 * 1000);
    const endDate = new Date(now.getTime() - parseInt(endDaysAgo) * 24 * 60 * 60 * 1000);

    // Generate the report
    const report = await this.alertService.generateWeeklyReport(startDate, endDate);

    // Format for API response
    return {
      success: true,
      message: `Weekly report generated for period ${startDate.toISOString()} to ${endDate.toISOString()}`,
      report: {
        period: {
          start: report.startDate,
          end: report.endDate,
        },
        stats: {
          totalAlerts: report.totalAlerts,
          byType: report.alertCounts,
          byNetwork: {
            mainnet: report.alertsByChain.mainnet,
            testnet: report.alertsByChain.testnet,
          },
          topAlertTypes: Object.entries(report.alertsByType)
            .sort(([, a], [, b]) => b - a)
            .slice(0, 5)
            .map(([type, count]) => ({ type, count })),
        },
        // Include component breakdown
        byComponent: Object.entries(report.alertsByComponent).map(([name, counts]) => ({
          name,
          counts,
        })),
      },
    };
  }

  /**
   * Get the formatted weekly report message
   * This returns the same format that would be sent to Telegram
   */
  @Get('weekly-report-message')
  async getWeeklyReportMessage(
    @Query('startDays') startDaysAgo: string = '7',
    @Query('endDays') endDaysAgo: string = '0',
  ) {
    this.logger.log('Getting formatted weekly report message');

    const now = new Date();
    const startDate = new Date(now.getTime() - parseInt(startDaysAgo) * 24 * 60 * 60 * 1000);
    const endDate = new Date(now.getTime() - parseInt(endDaysAgo) * 24 * 60 * 60 * 1000);

    // Generate the report
    const report = await this.alertService.getWeeklyReportForRange(startDate, endDate);

    // Get the formatted message that would be sent to Telegram
    const message = this.alertService.getFormattedWeeklyReportMessage(report);

    return {
      success: true,
      message: `Weekly report message generated for period ${startDate.toISOString()} to ${endDate.toISOString()}`,
      formattedReport: message,
    };
  }

  /**
   * Send the weekly report to communication channels
   * This will generate a report and actually send it to configured channels
   */
  @Post('send-weekly-report')
  async sendWeeklyReport(@Query('startDays') startDaysAgo: string = '7', @Query('endDays') endDaysAgo: string = '0') {
    this.logger.log('Manually sending weekly report');

    const now = new Date();
    const startDate = new Date(now.getTime() - parseInt(startDaysAgo) * 24 * 60 * 60 * 1000);
    const endDate = new Date(now.getTime() - parseInt(endDaysAgo) * 24 * 60 * 60 * 1000);

    // Generate the report
    const report = await this.alertService.generateWeeklyReport(startDate, endDate);

    // Send the report
    await this.alertService.sendWeeklyReport(report);

    return {
      success: true,
      message: `Weekly report sent for period ${startDate.toISOString()} to ${endDate.toISOString()}`,
    };
  }

  /**
   * Debug Telegram configuration - shows actual config values
   */
  @Get('debug-telegram-config')
  async debugTelegramConfig() {
    this.logger.log('Debugging Telegram configuration values');

    const monitoringConfig = this.configService.getMonitoringConfig();
    const alertNotifications = monitoringConfig.alertNotifications;

    return {
      success: true,
      telegramConfig: {
        botToken: alertNotifications.telegramBotToken ? '***configured***' : 'NOT CONFIGURED',
        chatId: alertNotifications.telegramChatId || 'NOT CONFIGURED',
        mainnetTopicId: alertNotifications.telegramMainnetTopicId || 'NOT CONFIGURED',
        testnetTopicId: alertNotifications.telegramTestnetTopicId || 'NOT CONFIGURED',
        enableTelegram: alertNotifications.enableTelegram,
      },
      diagnosis: {
        canSendTelegram: !!(alertNotifications.telegramBotToken && alertNotifications.telegramChatId),
        canRouteMainnet: !!alertNotifications.telegramMainnetTopicId,
        canRouteTestnet: !!alertNotifications.telegramTestnetTopicId,
        willGoToGeneral: !(alertNotifications.telegramMainnetTopicId && alertNotifications.telegramTestnetTopicId),
      },
      recommendation: this.generateTelegramRecommendation(alertNotifications),
    };
  }

  private generateTelegramRecommendation(config: any): string {
    if (!config.telegramBotToken || !config.telegramChatId) {
      return 'Configure TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID in your .env file';
    }

    if (!config.telegramTestnetTopicId) {
      return 'Configure TELEGRAM_TESTNET_TOPIC_ID in your .env file to route Testnet alerts to specific topic';
    }

    if (!config.telegramMainnetTopicId) {
      return 'Configure TELEGRAM_MAINNET_TOPIC_ID in your .env file to route Mainnet alerts to specific topic';
    }

    return 'All Telegram topic IDs are configured properly';
  }

  /**
   * Test the exact transaction failure alert flow for debugging
   */
  @Get('trace-transaction-alert-flow')
  async traceTransactionAlertFlow() {
    this.logger.log('Tracing transaction alert flow for debugging');

    // Get configuration like transaction monitor does
    const monitoringConfig = this.configService.getMonitoringConfig();
    this.logger.log(`Alert config: ${JSON.stringify(monitoringConfig.alertNotifications, null, 2)}`);

    // Simulate the exact same alert that transaction monitor sends
    const chainId = 51; // Testnet
    const alertType = 'TRANSACTION_FAILURE_RATE_HIGH';
    const component = 'transaction';
    const message = `High transaction failure rate on Testnet: 5/5 (100%) RPC endpoints failed to process normal transactions.

Failed endpoints:
  - https://rpc.apothem.network
  - https://erpc.apothem.network
  - https://earpc.apothem.network
  - https://rpc.ankr.com/xdc_testnet
  - https://apothem.xdcrpc.com`;

    this.logger.log(`About to call alertService.error with chainId: ${chainId}`);

    // Call exactly the same method as transaction monitor
    await this.alertService.error(alertType, component, message, chainId);

    this.logger.log('Transaction alert flow test completed');

    return {
      success: true,
      message: 'Traced transaction alert flow - check logs for detailed debugging info',
      testParams: {
        chainId: chainId,
        alertType: alertType,
        component: component,
        messageLength: message.length,
      },
      configuration: {
        testnetTopicId: monitoringConfig.alertNotifications.telegramTestnetTopicId,
        mainnetTopicId: monitoringConfig.alertNotifications.telegramMainnetTopicId,
        enableTelegram: monitoringConfig.alertNotifications.enableTelegram,
      },
    };
  }
}
