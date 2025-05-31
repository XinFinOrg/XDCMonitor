import { ALERTS, BLOCKCHAIN } from '@common/constants/config';
import { AlertCategory, AlertManager, Alert as AlertManagerAlert, AlertSeverity } from '@common/utils/alert-manager';
import { ConfigService } from '@config/config.service';
import { QueryApi } from '@influxdata/influxdb-client';
import { MetricsService } from '@metrics/metrics.service';
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import axios from 'axios';

export interface Alert {
  type: 'error' | 'warning' | 'info';
  title: string;
  message: string;
  timestamp: Date;
  component?: string;
  chainId?: number;
}

export interface WeeklyAlertReport {
  startDate: Date;
  endDate: Date;
  totalAlerts: number;
  alertCounts: {
    error: number;
    warning: number;
    info: number;
  };
  alertsByComponent: Record<
    string,
    {
      total: number;
      error: number;
      warning: number;
      info: number;
    }
  >;
  alertsByType: Record<string, number>;
  alertsByChain: {
    mainnet: {
      total: number;
      error: number;
      warning: number;
      info: number;
    };
    testnet: {
      total: number;
      error: number;
      warning: number;
      info: number;
    };
  };
  alerts: Alert[];
}

@Injectable()
export class AlertService implements OnModuleInit {
  private readonly logger = new Logger(AlertService.name);
  private alerts: Alert[] = [];
  private alertThrottling: Record<string, number> = {};
  private weeklyReports: WeeklyAlertReport[] = [];
  private lastWeeklyReportDate: Date | null = null;
  private isInitialized = false;
  private queryApi: QueryApi;

  constructor(
    private readonly configService: ConfigService,
    private readonly metricsService: MetricsService,
    private readonly alertManager: AlertManager,
  ) {
    this.initializeAlertManager();
  }

  private async initializeQueryApi(): Promise<void> {
    const influxConfig = this.configService.getInfluxDbConfig();

    // Try up to 5 times with increasing delays
    for (let attempt = 1; attempt <= 5; attempt++) {
      try {
        const influxClient = this.metricsService.getInfluxClient();
        if (influxClient) {
          this.queryApi = influxClient.getQueryApi(influxConfig.org);
          this.logger.log('InfluxDB query API initialized for alerts service');
          return;
        } else {
          this.logger.debug(
            `InfluxDB client not available yet (attempt ${attempt}/5), retrying in ${attempt * 1000}ms`,
          );
          // Wait before trying again, with increasing delay
          await new Promise(resolve => setTimeout(resolve, attempt * 1000));
        }
      } catch (error) {
        this.logger.warn(`Failed to initialize InfluxDB query API (attempt ${attempt}/5): ${error.message}`);
        // Wait before trying again
        await new Promise(resolve => setTimeout(resolve, attempt * 1000));
      }
    }

    this.logger.warn(
      'Unable to initialize InfluxDB query API after multiple attempts - will use in-memory alerts only',
    );
  }

  /**
   * Query alerts from InfluxDB for a specific date range
   * This ensures we get all alerts, even those that occurred before the app started
   */
  async queryAlertsFromInfluxDB(startDate: Date, endDate: Date): Promise<Alert[]> {
    if (!this.queryApi) {
      this.logger.warn('InfluxDB query API not initialized, falling back to in-memory alerts');
      return this.alerts.filter(alert => alert.timestamp >= startDate && alert.timestamp <= endDate);
    }

    const bucket = this.configService.getInfluxDbConfig().bucket;
    const startTime = startDate.toISOString();
    const endTime = endDate.toISOString();

    try {
      this.logger.log(`Querying alerts from InfluxDB from ${startTime} to ${endTime}`);

      // Query alert_history measurement from InfluxDB
      const query = `
        from(bucket: "${bucket}")
          |> range(start: ${startTime}, stop: ${endTime})
          |> filter(fn: (r) => r._measurement == "alert_history")
          |> pivot(rowKey:["_time"], columnKey: ["_field"], valueColumn: "_value")
      `;

      const results: Alert[] = [];
      const rows = await this.queryApi.collectRows(query);

      for (const row of rows) {
        // Cast row to an object with the expected properties
        const typedRow = row as {
          type: string;
          title: string;
          value: string;
          _time: string;
          component: string;
          chainId: number | undefined;
        };

        // Only add if it has the required properties
        if (typedRow.type && typedRow.title && typedRow._time) {
          results.push({
            type: typedRow.type as 'error' | 'warning' | 'info',
            title: typedRow.title,
            message: typedRow.value || '',
            timestamp: new Date(typedRow._time),
            component: typedRow.component || 'system',
            chainId: typedRow.chainId || undefined,
          });
        }
      }

      this.logger.log(`Retrieved ${results.length} alerts from InfluxDB`);
      return results;
    } catch (error) {
      this.logger.error(`Failed to query alerts from InfluxDB: ${error.message}`);
      // Fall back to in-memory alerts if InfluxDB query fails
      return this.alerts.filter(alert => alert.timestamp >= startDate && alert.timestamp <= endDate);
    }
  }

  async onModuleInit() {
    // Initialize InfluxDB query API first
    await this.initializeQueryApi();

    // Only generate initial report if we haven't initialized yet
    if (!this.isInitialized) {
      await this.generateWeeklyReportIfNeeded();
      this.isInitialized = true;
    }
  }

  /**
   * Generate weekly report if it's time (every Sunday at midnight)
   */
  @Cron(CronExpression.EVERY_WEEK)
  async generateWeeklyReportIfNeeded() {
    // Skip if we're not initialized yet (let onModuleInit handle it)
    if (!this.isInitialized) {
      return;
    }

    const now = new Date();
    const lastReport = this.lastWeeklyReportDate;

    // If we've never generated a report or it's been more than 6 days
    if (!lastReport || now.getTime() - lastReport.getTime() > 6 * 24 * 60 * 60 * 1000) {
      try {
        // Generate report for the past week
        const report = await this.generateWeeklyReport(new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000), now);

        // Send report to configured channels
        await this.sendWeeklyReport(report);

        // Update last report date
        this.lastWeeklyReportDate = now;

        this.logger.log('Weekly alert report generated and sent successfully');
      } catch (error) {
        this.logger.error(`Failed to generate weekly report: ${error.message}`);
      }
    }
  }

  /**
   * Send weekly report to configured channels
   */
  public async sendWeeklyReport(report: WeeklyAlertReport): Promise<void> {
    // Format report for sending
    const message = this.formatWeeklyReportMessage(report);

    // Create a unique key for this report to prevent duplicates
    const reportKey = `weekly_report_${report.startDate.getTime()}_${report.endDate.getTime()}`;

    // Check if we've already sent this report
    if (this.alertThrottling[reportKey]) {
      this.logger.debug('Weekly report already sent, skipping duplicate');
      return;
    }

    try {
      // Use AlertManager to send report
      this.alertManager.addAlert({
        severity: AlertSeverity.INFO,
        category: AlertCategory.SYSTEM,
        component: 'system',
        title: 'Weekly Alert Report',
        message: message,
        shouldNotify: true,
      });

      // Mark this report as sent
      this.alertThrottling[reportKey] = Date.now();

      this.logger.log('Weekly report sent successfully');
    } catch (error) {
      this.logger.error(`Failed to send weekly report: ${error.message}`);
    }
  }

  /**
   * Get the formatted weekly report message
   * This returns the same text that would be sent to Telegram
   */
  public getFormattedWeeklyReportMessage(report: WeeklyAlertReport): string {
    return this.formatWeeklyReportMessage(report);
  }

  /**
   * Format a severity table for the weekly report
   */
  private formatSeverityTable(counts: { error: number; warning: number; info: number }, title: string): string {
    let message = `<b>${title}:</b>\n`;
    message += `<pre>`;
    message += `+--------------+--------+\n`;
    message += `| Severity     | Count  |\n`;
    message += `+--------------+--------+\n`;

    if (counts.error > 0 || counts.warning > 0 || counts.info > 0) {
      message += `| Errors       | ${String(counts.error).padEnd(6)} |\n`;
      message += `| Warnings     | ${String(counts.warning).padEnd(6)} |\n`;
      message += `| Info         | ${String(counts.info).padEnd(6)} |\n`;
    } else {
      message += `| No alerts    | -      |\n`;
    }

    message += `+--------------+--------+\n`;
    message += `</pre>\n\n`;

    return message;
  }

  /**
   * Format weekly report into a readable message
   */
  private formatWeeklyReportMessage(report: WeeklyAlertReport): string {
    const startDate = report.startDate.toLocaleDateString();
    const endDate = report.endDate.toLocaleDateString();

    let message = `🔵 <b>Weekly Alert Report</b>\n`;
    message += `<b>Period:</b> ${startDate} to ${endDate}\n\n`;

    // Total alerts
    message += `<b>Total Alerts:</b> ${report.totalAlerts}\n\n`;

    // Overall alert statistics
    message += this.formatSeverityTable(report.alertCounts, 'Overall Alert Statistics');

    // MAINNET SECTION
    message += `\n🔷 <b>MAINNET ALERTS</b> (Total: ${report.alertsByChain.mainnet.total})\n\n`;

    // Mainnet severity breakdown
    message += this.formatSeverityTable(report.alertsByChain.mainnet, 'Mainnet Alert Breakdown');

    // Get Mainnet components
    const mainnetComponents = this.getComponentCounts(report.alerts, alert => this.isMainnetAlert(alert));
    message += this.formatComponentsTable(mainnetComponents, 'Mainnet Components');

    // TESTNET SECTION
    message += `\n🔶 <b>TESTNET ALERTS</b> (Total: ${report.alertsByChain.testnet.total})\n\n`;

    // Testnet severity breakdown
    message += this.formatSeverityTable(report.alertsByChain.testnet, 'Testnet Alert Breakdown');

    // Get Testnet components
    const testnetComponents = this.getComponentCounts(report.alerts, alert => this.isTestnetAlert(alert));
    message += this.formatComponentsTable(testnetComponents, 'Testnet Components');

    // Most frequent alert types
    message += `\n<b>Most Frequent Alert Types:</b>\n`;
    message += `<pre>`;
    message += `+-------------------------------------------------+--------+\n`;
    message += `| Alert Type                                      | Count  |\n`;
    message += `+-------------------------------------------------+--------+\n`;

    const sortedTypes = Object.entries(report.alertsByType)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 5);

    if (sortedTypes.length > 0) {
      sortedTypes.forEach(([type, count]) => {
        // For consistent table width, we pad strings with spaces
        const typeStr = type.length > 47 ? type.substring(0, 44) + '...' : type;
        message += `| ${typeStr.padEnd(47)} | ${String(count).padEnd(6)} |\n`;
      });
    } else {
      message += `| No alert types recorded                           | -      |\n`;
    }

    message += `+-------------------------------------------------+--------+\n`;
    message += `</pre>\n`;

    return message;
  }

  /**
   * Generate a weekly report of alerts
   */
  async generateWeeklyReport(startDate?: Date, endDate?: Date): Promise<WeeklyAlertReport> {
    const now = new Date();
    const reportStartDate = startDate || new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000); // Default to last 7 days
    const reportEndDate = endDate || now;

    // Get alerts from both in-memory array and InfluxDB
    let alertsInRange: Alert[] = [];

    try {
      // Query alerts from InfluxDB to ensure we have complete history
      alertsInRange = await this.queryAlertsFromInfluxDB(reportStartDate, reportEndDate);

      // Add any in-memory alerts that might not be in InfluxDB yet
      const inMemoryAlerts = this.alerts.filter(
        alert => alert.timestamp >= reportStartDate && alert.timestamp <= reportEndDate,
      );

      // Create a Set of timestamps to avoid duplicates
      const existingTimestamps = new Set(alertsInRange.map(a => a.timestamp.getTime()));

      // Add in-memory alerts that aren't already in the results
      for (const alert of inMemoryAlerts) {
        if (!existingTimestamps.has(alert.timestamp.getTime())) {
          alertsInRange.push(alert);
        }
      }

      this.logger.log(
        `Generated weekly report with ${alertsInRange.length} alerts from ${reportStartDate.toISOString()} to ${reportEndDate.toISOString()}`,
      );
    } catch (error) {
      this.logger.error(`Error fetching alerts for report: ${error.message}, falling back to in-memory alerts only`);
      // Fallback to in-memory alerts only
      alertsInRange = this.alerts.filter(
        alert => alert.timestamp >= reportStartDate && alert.timestamp <= reportEndDate,
      );
    }

    // Initialize report structure
    const report: WeeklyAlertReport = {
      startDate: reportStartDate,
      endDate: reportEndDate,
      totalAlerts: alertsInRange.length,
      alertCounts: {
        error: 0,
        warning: 0,
        info: 0,
      },
      alertsByComponent: {},
      alertsByType: {},
      alertsByChain: {
        mainnet: {
          total: 0,
          error: 0,
          warning: 0,
          info: 0,
        },
        testnet: {
          total: 0,
          error: 0,
          warning: 0,
          info: 0,
        },
      },
      alerts: alertsInRange,
    };

    // Process each alert to generate statistics
    alertsInRange.forEach(alert => {
      // Count by severity
      report.alertCounts[alert.type]++;

      // Count by component
      const component = alert.component || 'system';
      if (!report.alertsByComponent[component]) {
        report.alertsByComponent[component] = {
          total: 0,
          error: 0,
          warning: 0,
          info: 0,
        };
      }
      report.alertsByComponent[component].total++;
      report.alertsByComponent[component][alert.type]++;

      // Count by alert type (title)
      report.alertsByType[alert.title] = (report.alertsByType[alert.title] || 0) + 1;

      // Determine which chain this alert belongs to
      if (this.isTestnetAlert(alert)) {
        report.alertsByChain.testnet.total++;
        report.alertsByChain.testnet[alert.type]++;
      } else {
        // All non-testnet alerts are assigned to mainnet by default
        report.alertsByChain.mainnet.total++;
        report.alertsByChain.mainnet[alert.type]++;
      }
    });

    // Log component and chain statistics for debugging
    this.logger.debug(`Weekly report generated with ${alertsInRange.length} alerts`);
    this.logger.debug(`Components found: ${Object.keys(report.alertsByComponent).length}`);
    this.logger.debug(
      `Network breakdown - Mainnet: ${report.alertsByChain.mainnet.total}, Testnet: ${report.alertsByChain.testnet.total}`,
    );

    // Store the report
    this.weeklyReports.push(report);

    // Keep only last 4 weeks of reports
    if (this.weeklyReports.length > 4) {
      this.weeklyReports.shift();
    }

    return report;
  }

  /**
   * Get all weekly reports
   */
  getWeeklyReports(): WeeklyAlertReport[] {
    return this.weeklyReports;
  }

  /**
   * Get the most recent weekly report
   */
  getLatestWeeklyReport(): WeeklyAlertReport | null {
    return this.weeklyReports.length > 0 ? this.weeklyReports[this.weeklyReports.length - 1] : null;
  }

  /**
   * Generate a weekly report on demand for a specific time range
   */
  async getWeeklyReportForRange(startDate: Date, endDate: Date): Promise<WeeklyAlertReport> {
    return this.generateWeeklyReport(startDate, endDate);
  }

  /**
   * Get alerts for a specific component
   */
  getAlertsByComponent(component: string, startDate?: Date, endDate?: Date): Alert[] {
    const now = new Date();
    const reportStartDate = startDate || new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const reportEndDate = endDate || now;

    return this.alerts.filter(
      alert => alert.component === component && alert.timestamp >= reportStartDate && alert.timestamp <= reportEndDate,
    );
  }

  /**
   * Get alerts by severity type
   */
  getAlertsByType(type: 'error' | 'warning' | 'info', startDate?: Date, endDate?: Date): Alert[] {
    const now = new Date();
    const reportStartDate = startDate || new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const reportEndDate = endDate || now;

    return this.alerts.filter(
      alert => alert.type === type && alert.timestamp >= reportStartDate && alert.timestamp <= reportEndDate,
    );
  }

  /**
   * Get alert statistics for a date range
   */
  getAlertStatistics(
    startDate?: Date,
    endDate?: Date,
  ): {
    total: number;
    byType: Record<string, number>;
    byComponent: Record<string, number>;
  } {
    const now = new Date();
    const reportStartDate = startDate || new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const reportEndDate = endDate || now;

    const alertsInRange = this.alerts.filter(
      alert => alert.timestamp >= reportStartDate && alert.timestamp <= reportEndDate,
    );

    const stats = {
      total: alertsInRange.length,
      byType: {},
      byComponent: {},
    };

    alertsInRange.forEach(alert => {
      // Count by type
      stats.byType[alert.type] = (stats.byType[alert.type] || 0) + 1;

      // Count by component
      const component = alert.component || 'system';
      stats.byComponent[component] = (stats.byComponent[component] || 0) + 1;
    });

    return stats;
  }

  /**
   * Clear old alerts and reports
   */
  clearOldData(maxAgeDays: number = 30): void {
    const cutoffDate = new Date(Date.now() - maxAgeDays * 24 * 60 * 60 * 1000);

    // Clear old alerts
    this.alerts = this.alerts.filter(alert => alert.timestamp >= cutoffDate);

    // Clear old reports
    this.weeklyReports = this.weeklyReports.filter(report => report.endDate >= cutoffDate);

    this.logger.log(`Cleared alerts and reports older than ${maxAgeDays} days`);
  }

  /**
   * Initialize the AlertManager with notification channels
   */
  private initializeAlertManager(): void {
    const channels = [];
    const alertConfig = this.configService.getMonitoringConfig().alertNotifications;

    // Add webhook channel if configured
    if (alertConfig.webhookUrl) {
      channels.push({
        id: 'webhook',
        name: 'Webhook Notifications',
        type: 'webhook' as const,
        enabled: alertConfig.enableWebhook,
        config: {
          url: alertConfig.webhookUrl,
          headers: {},
        },
      });
    }

    // Add Telegram channel if configured
    if (alertConfig.telegramBotToken && alertConfig.telegramChatId) {
      channels.push({
        id: 'telegram',
        name: 'Telegram Notifications',
        type: 'telegram' as const,
        enabled: alertConfig.enableTelegram,
        config: {
          botToken: alertConfig.telegramBotToken,
          chatId: alertConfig.telegramChatId,
          mainnetTopicId: alertConfig.telegramMainnetTopicId,
          testnetTopicId: alertConfig.telegramTestnetTopicId,
        },
      });
    }

    // Add dashboard channel
    channels.push({
      id: 'dashboard',
      name: 'Dashboard Notifications',
      type: 'dashboard' as const,
      enabled: alertConfig.enableDashboard,
      config: {},
    });

    this.alertManager.configureNotificationChannels(channels);
  }

  /**
   * Get all alerts
   */
  getAllAlerts(): Alert[] {
    // We'll maintain backwards compatibility by converting AlertManager alerts to the old format
    const managerAlerts = this.alertManager.getAlerts();

    return [...this.alerts, ...managerAlerts.map(this.convertToLegacyAlert)];
  }

  /**
   * Convert AlertManager alert to legacy format
   */
  private convertToLegacyAlert(alert: AlertManagerAlert): Alert {
    return {
      type: this.mapSeverityToType(alert.severity),
      title: alert.title,
      message: alert.message,
      timestamp: new Date(alert.timestamp),
      component: alert.component,
    };
  }

  /**
   * Map AlertManager severity to legacy type
   */
  private mapSeverityToType(severity: AlertSeverity): 'error' | 'warning' | 'info' {
    switch (severity) {
      case AlertSeverity.CRITICAL:
        return 'error';
      case AlertSeverity.WARNING:
        return 'warning';
      case AlertSeverity.INFO:
        return 'info';
      default:
        return 'info';
    }
  }

  /**
   * Map legacy type to AlertManager severity
   */
  private mapTypeToSeverity(type: 'error' | 'warning' | 'info'): AlertSeverity {
    switch (type) {
      case 'error':
        return AlertSeverity.CRITICAL;
      case 'warning':
        return AlertSeverity.WARNING;
      case 'info':
        return AlertSeverity.INFO;
      default:
        return AlertSeverity.INFO;
    }
  }

  /**
   * Add a new alert and potentially send notifications
   */
  async addAlert(alert: Omit<Alert, 'timestamp'>, chainId?: number): Promise<void> {
    this.logger.log(
      `AlertService.addAlert called with chainId: ${chainId}, alert type: ${alert.type}, title: ${alert.title}`,
    );

    const fullAlert: Alert = {
      ...alert,
      timestamp: new Date(),
      chainId,
    };

    // Add to legacy alerts for backwards compatibility
    this.alerts.push(fullAlert);
    this.logger.warn(`ALERT [${alert.type}]: ${alert.title} - ${alert.message}`);

    // Limit stored alerts to prevent memory issues
    if (this.alerts.length > 100) {
      this.alerts.shift();
    }

    this.logger.log(`AlertService.addAlert calling AlertManager.addAlert with chainId: ${chainId}`);
    // Use the AlertManager for new alerts
    this.alertManager.addAlert({
      severity: this.mapTypeToSeverity(alert.type),
      category: AlertCategory.BLOCKCHAIN,
      component: alert.component || 'system',
      title: alert.title,
      message: alert.message,
      chainId: chainId,
      shouldNotify: true,
      metadata: {
        chainId: chainId,
      },
    });

    this.metricsService.saveAlert(fullAlert, chainId);
  }

  /**
   * Create an error-level alert
   */
  async error(alertType: string, component: string, message: string, chainId?: number): Promise<void> {
    this.logger.log(
      `AlertService.error called - alertType: ${alertType}, component: ${component}, chainId: ${chainId}`,
    );

    if (this.shouldThrottle(alertType, message, chainId)) {
      this.logger.debug(`Throttling error alert: ${alertType}`);
      return;
    }

    this.logger.log(`AlertService.error calling addAlert with chainId: ${chainId}`);
    await this.addAlert(
      {
        type: 'error',
        component,
        title: this.formatAlertTitle(alertType),
        message,
      },
      chainId,
    );
  }

  /**
   * Create a warning-level alert
   * Warnings are saved to the database but not sent as notifications
   */
  async warning(alertType: string, component: string, message: string, chainId?: number): Promise<void> {
    if (this.shouldThrottle(alertType, message, chainId)) {
      this.logger.debug(`Throttling warning alert: ${alertType}`);
      return;
    }

    this.logger.warn(`WARNING ALERT: ${alertType} - ${message} (${chainId || 'unknown'})`);

    // Create warning alert with shouldNotify: false
    const alert: Omit<Alert, 'timestamp'> = {
      type: 'warning',
      component,
      title: this.formatAlertTitle(alertType),
      message,
      chainId,
    };

    // Add to legacy alerts
    const fullAlert = {
      ...alert,
      timestamp: new Date(),
    };
    this.alerts.push(fullAlert);

    // Limit stored alerts to prevent memory issues
    if (this.alerts.length > 100) {
      this.alerts.shift();
    }

    // Use the AlertManager with shouldNotify false
    this.alertManager.addAlert({
      severity: AlertSeverity.WARNING,
      category: AlertCategory.BLOCKCHAIN,
      component: component || 'system',
      title: this.formatAlertTitle(alertType),
      message,
      chainId: chainId,
      shouldNotify: false,
      metadata: {
        chainId,
      },
    });

    // Save to metrics database
    this.metricsService.saveAlert(fullAlert, chainId);
  }

  /**
   * Create an info-level alert
   */
  async info(alertType: string, component: string, message: string, chainId?: number): Promise<void> {
    if (this.shouldThrottle(alertType, message, chainId)) {
      this.logger.debug(`Throttling info alert: ${alertType}`);
      return;
    }

    await this.addAlert(
      {
        type: 'info',
        component,
        title: this.formatAlertTitle(alertType),
        message,
      },
      chainId,
    );
  }

  /**
   * Check if an alert should be throttled
   *
   * Note: For SYNC_BLOCKS_LAG alerts, this acts as a secondary throttling mechanism.
   * The primary throttling happens in BlocksMonitorService.checkForBlockHeightLag
   * which prevents alerts from even reaching this method during the throttle period.
   * Both use the same config value: ALERTS.NOTIFICATIONS.THROTTLE_SECONDS.SYNC_BLOCKS_LAG
   */
  private shouldThrottle(alertType: string, message?: string, chainId?: number): boolean {
    const now = Date.now();

    // Create a throttling key that includes chainId to throttle alerts per chain
    const throttleKey = chainId ? `${alertType}_chain_${chainId}` : alertType;
    const lastTime = this.alertThrottling[throttleKey] || 0;

    // Get throttle time for this alert type or use default
    let throttleSeconds =
      ALERTS.NOTIFICATIONS.THROTTLE_SECONDS[alertType] || ALERTS.NOTIFICATIONS.THROTTLE_SECONDS.DEFAULT;

    // For SYNC_BLOCKS_LAG alerts, check if multiple endpoints are affected and use longer throttling
    if (alertType === ALERTS.TYPES.SYNC_BLOCKS_LAG && message) {
      // Extract number of affected endpoints from the message
      const matchResult = message.match(/(\d+)\s+RPC\s+endpoint/i);
      if (matchResult && matchResult[1]) {
        const endpointCount = parseInt(matchResult[1], 10);

        // If many endpoints are affected, use the longer throttle time
        if (endpointCount > 3) {
          throttleSeconds = ALERTS.NOTIFICATIONS.THROTTLE_SECONDS.SYNC_BLOCKS_LAG_MANY_ENDPOINTS;
          this.logger.debug(
            `Using extended throttle time (${throttleSeconds}s) for SYNC_BLOCKS_LAG alert with ${endpointCount} endpoints`,
          );
        }
      }
    }

    if (now - lastTime < throttleSeconds * 1000) {
      return true;
    }

    // Update last alert time using the chain-specific key
    this.alertThrottling[throttleKey] = now;
    return false;
  }

  /**
   * Format an alert title based on alert type
   */
  private formatAlertTitle(alertType: string): string {
    return alertType
      .split('_')
      .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
      .join(' ');
  }

  /**
   * Create an alert for a threshold being crossed
   */
  async createThresholdAlert(
    severity: 'info' | 'warning' | 'error',
    component: string,
    title: string,
    currentValue: number,
    thresholdValue: number,
    unit: string = '',
    chainId?: number,
  ): Promise<void> {
    const message = `Current value: ${currentValue}${unit} (Threshold: ${thresholdValue}${unit})`;
    switch (severity) {
      case 'error':
        await this.error(ALERTS.TYPES.THRESHOLD_EXCEEDED, component, `${title} - ${message}`, chainId);
        break;
      case 'warning':
        // Use warning method - will save alert to database but not send notifications
        await this.warning(ALERTS.TYPES.THRESHOLD_WARNING, component, `${title} - ${message}`, chainId);
        break;
      case 'info':
        await this.info(ALERTS.TYPES.THRESHOLD_NOTIFICATION, component, `${title} - ${message}`, chainId);
        break;
    }
  }

  /**
   * Determine if an alert is for Mainnet based on chainId or content patterns
   */
  private isMainnetAlert(alert: Alert): boolean {
    // First check chainId if available
    if (alert.chainId === BLOCKCHAIN.CHAIN_IDS_NUM.MAINNET) {
      return true;
    }

    // If chainId is not matching or missing, check title and message content
    const titleAndMessage = `${alert.title} ${alert.message}`.toLowerCase();
    return (
      titleAndMessage.includes('mainnet') ||
      titleAndMessage.includes('chain 50') ||
      titleAndMessage.includes('chainid 50') ||
      titleAndMessage.includes('chain id 50') ||
      // If it's neither obviously mainnet nor obviously testnet (see isTestnetAlert),
      // default to mainnet for priority alerts like errors
      (alert.type === 'error' && !this.isTestnetAlert(alert))
    );
  }

  /**
   * Determine if an alert is for Testnet based on chainId or content patterns
   */
  private isTestnetAlert(alert: Alert): boolean {
    // First check chainId if available
    if (alert.chainId === BLOCKCHAIN.CHAIN_IDS_NUM.TESTNET) {
      return true;
    }

    // If chainId is not matching or missing, check title and message content
    const titleAndMessage = `${alert.title} ${alert.message}`.toLowerCase();
    return (
      titleAndMessage.includes('testnet') ||
      titleAndMessage.includes('chain 51') ||
      titleAndMessage.includes('chainid 51') ||
      titleAndMessage.includes('chain id 51')
    );
  }

  /**
   * Format a components table for the weekly report
   */
  private formatComponentsTable(components: Array<[string, any]>, title: string): string {
    let message = `<b>${title}:</b>\n`;
    message += `<pre>`;
    message += `+-------------------------+--------+--------+--------+--------+\n`;
    message += `| Component               | Total  | Errors | Warn   | Info   |\n`;
    message += `+-------------------------+--------+--------+--------+--------+\n`;

    if (components.length > 0) {
      components.forEach(([component, counts]) => {
        // For consistent table width, we pad strings with spaces
        const componentStr = component.length > 23 ? component.substring(0, 20) + '...' : component;
        message += `| ${componentStr.padEnd(23)} | ${String(counts.total).padEnd(6)} | ${String(counts.error).padEnd(6)} | ${String(counts.warning).padEnd(6)} | ${String(counts.info).padEnd(6)} |\n`;
      });
    } else {
      // No components found - display empty message in table
      message += `| No components affected  | -      | -      | -      | -      |\n`;
    }

    message += `+-------------------------+--------+--------+--------+--------+\n`;
    message += `</pre>\n\n`;

    return message;
  }

  /**
   * Get component counts based on alert filter function
   */
  private getComponentCounts(alerts: Alert[], filterFn: (alert: Alert) => boolean): Array<[string, any]> {
    const componentAlerts = {};

    // Process alerts according to filter
    alerts.forEach(alert => {
      // Skip alerts without component
      if (!alert.component || !filterFn(alert)) return;

      // Initialize component counter if needed
      if (!componentAlerts[alert.component]) {
        componentAlerts[alert.component] = {
          total: 0,
          error: 0,
          warning: 0,
          info: 0,
        };
      }

      // Count this alert
      componentAlerts[alert.component].total++;
      componentAlerts[alert.component][alert.type]++;
    });

    // Convert to array format
    return Object.entries(componentAlerts);
  }
}
