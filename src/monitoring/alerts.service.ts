import { ALERTS } from '@common/constants/config';
import { AlertCategory, AlertManager, Alert as AlertManagerAlert, AlertSeverity } from '@common/utils/alert-manager';
import { ConfigService } from '@config/config.service';
import { MetricsService } from '@metrics/metrics.service';
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import axios from 'axios';
import { QueryApi } from '@influxdata/influxdb-client';

export interface Alert {
  type: 'error' | 'warning' | 'info';
  title: string;
  message: string;
  timestamp: Date;
  component?: string;
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
  alerts: Alert[];
}

@Injectable()
export class AlertsService implements OnModuleInit {
  private readonly logger = new Logger(AlertsService.name);
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
        };

        // Only add if it has the required properties
        if (typedRow.type && typedRow.title && typedRow._time) {
          results.push({
            type: typedRow.type as 'error' | 'warning' | 'info',
            title: typedRow.title,
            message: typedRow.value || '',
            timestamp: new Date(typedRow._time),
            component: typedRow.component || 'system',
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
  private async sendWeeklyReport(report: WeeklyAlertReport): Promise<void> {
    const alertConfig = this.configService.getMonitoringConfig().alertNotifications;

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
      // Send to Telegram if configured
      if (alertConfig.enableTelegram && alertConfig.telegramBotToken && alertConfig.telegramChatId) {
        await this.sendToTelegram(message);
      }

      // Send to webhook if configured
      if (alertConfig.enableWebhook && alertConfig.webhookUrl) {
        await this.sendToWebhook({
          type: 'info',
          title: 'Weekly Alert Report',
          message: message,
          timestamp: new Date(),
          component: 'system',
        });
      }

      // Mark this report as sent
      this.alertThrottling[reportKey] = Date.now();

      this.logger.log('Weekly report sent successfully');
    } catch (error) {
      this.logger.error(`Failed to send weekly report: ${error.message}`);
    }
  }

  /**
   * Format weekly report into a readable message
   */
  private formatWeeklyReportMessage(report: WeeklyAlertReport): string {
    const startDate = report.startDate.toLocaleDateString();
    const endDate = report.endDate.toLocaleDateString();

    let message = `📊 *Weekly Alert Report*\n`;
    message += `Period: ${startDate} to ${endDate}\n\n`;

    // Total alerts
    message += `*Total Alerts:* ${report.totalAlerts}\n`;

    // Alert counts by severity
    message += `\n*Alert Counts:*\n`;
    message += `🚨 Errors: ${report.alertCounts.error}\n`;
    message += `⚠️ Warnings: ${report.alertCounts.warning}\n`;
    message += `ℹ️ Info: ${report.alertCounts.info}\n`;

    // Alerts by component
    message += `\n*Alerts by Component:*\n`;
    Object.entries(report.alertsByComponent).forEach(([component, counts]) => {
      message += `\n${component}:\n`;
      message += `  Total: ${counts.total}\n`;
      message += `  Errors: ${counts.error}\n`;
      message += `  Warnings: ${counts.warning}\n`;
      message += `  Info: ${counts.info}\n`;
    });

    // Most frequent alert types
    message += `\n*Most Frequent Alert Types:*\n`;
    const sortedTypes = Object.entries(report.alertsByType)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 5);

    sortedTypes.forEach(([type, count]) => {
      message += `${type}: ${count}\n`;
    });

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
      alerts: alertsInRange,
    };

    // Process alerts
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
    });

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
    const fullAlert: Alert = {
      ...alert,
      timestamp: new Date(),
    };

    // Add to legacy alerts for backwards compatibility
    this.alerts.push(fullAlert);
    this.logger.warn(`ALERT [${alert.type}]: ${alert.title} - ${alert.message}`);

    // Limit stored alerts to prevent memory issues
    if (this.alerts.length > 100) {
      this.alerts.shift();
    }

    // Use the AlertManager for new alerts
    this.alertManager.addAlert({
      severity: this.mapTypeToSeverity(alert.type),
      category: AlertCategory.BLOCKCHAIN,
      component: alert.component || 'system',
      title: alert.title,
      message: alert.message,
      shouldNotify: true,
    });

    this.metricsService.saveAlert(fullAlert, chainId);
  }

  /**
   * Create an error-level alert
   */
  async error(alertType: string, component: string, message: string, chainId?: number): Promise<void> {
    if (this.shouldThrottle(alertType)) {
      this.logger.debug(`Throttling error alert: ${alertType}`);
      return;
    }

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
    if (this.shouldThrottle(alertType)) {
      this.logger.debug(`Throttling warning alert: ${alertType}`);
      return;
    }

    this.logger.warn(`WARNING ALERT: ${alertType} - ${message} (${chainId || 'unknown'})`);

    const alert: Omit<Alert, 'timestamp'> = {
      type: 'warning',
      component,
      title: this.formatAlertTitle(alertType),
      message,
    };

    // Add to legacy alerts for backwards compatibility
    this.alerts.push({
      ...alert,
      timestamp: new Date(),
    });

    // Limit stored alerts to prevent memory issues
    if (this.alerts.length > 100) {
      this.alerts.shift();
    }

    // Use the AlertManager for warnings but with shouldNotify false
    this.alertManager.addAlert({
      severity: AlertSeverity.WARNING,
      category: AlertCategory.BLOCKCHAIN,
      component: component || 'system',
      title: this.formatAlertTitle(alertType),
      message,
      shouldNotify: false, // Don't trigger notifications for warnings
    });

    // Save warning to metrics database
    this.metricsService.saveAlert(
      {
        ...alert,
        timestamp: new Date(),
      },
      chainId,
    );
  }

  /**
   * Create an info-level alert
   */
  async info(alertType: string, component: string, message: string, chainId?: number): Promise<void> {
    if (this.shouldThrottle(alertType)) {
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
   */
  private shouldThrottle(alertType: string): boolean {
    const now = Date.now();
    const lastTime = this.alertThrottling[alertType] || 0;

    // Get throttle time for this alert type or use default
    const throttleSeconds =
      ALERTS.NOTIFICATIONS.THROTTLE_SECONDS[alertType] || ALERTS.NOTIFICATIONS.THROTTLE_SECONDS.DEFAULT;

    if (now - lastTime < throttleSeconds * 1000) {
      return true;
    }

    // Update last alert time
    this.alertThrottling[alertType] = now;
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
        await this.error('threshold_exceeded', component, `${title} - ${message}`, chainId);
        break;
      case 'warning':
        // Use warning method - will save alert to database but not send notifications
        await this.warning('threshold_warning', component, `${title} - ${message}`, chainId);
        break;
      case 'info':
        await this.info('threshold_notification', component, `${title} - ${message}`, chainId);
        break;
    }
  }

  /**
   * Send alert to dashboard
   */
  private sendToDashboard(alert: Alert): void {
    this.logger.debug(`Sending alert to dashboard: ${alert.title}`);
    // In a real implementation, this might use a WebSocket or other mechanism
  }

  /**
   * Send alert to chat channels (Telegram, webhook, etc.)
   */
  private async sendToChat(alert: Alert): Promise<void> {
    if (
      !this.configService.getMonitoringConfig().alertNotifications.enableWebhook &&
      !this.configService.getMonitoringConfig().alertNotifications.enableTelegram
    ) {
      return;
    }

    try {
      const message = this.formatChatMessage(alert);

      // Send to Telegram if configured
      if (
        this.configService.getMonitoringConfig().alertNotifications.telegramBotToken &&
        this.configService.getMonitoringConfig().alertNotifications.telegramChatId
      ) {
        await this.sendToTelegram(message);
      }

      // Send to webhook if configured
      if (this.configService.getMonitoringConfig().alertNotifications.webhookUrl) {
        await this.sendToWebhook(alert);
      }
    } catch (error) {
      this.logger.error(`Failed to send alert to chat: ${error.message}`);
    }
  }

  /**
   * Format alert for chat message
   */
  private formatChatMessage(alert: Alert): string {
    const emoji = alert.type === 'error' ? '🚨' : alert.type === 'warning' ? '⚠️' : 'ℹ️';
    const timestamp = alert.timestamp.toISOString();

    return `${emoji} *${alert.title}*\n${alert.message}\n\nComponent: ${alert.component || 'system'}\nTime: ${timestamp}`;
  }

  /**
   * Send an alert to Telegram
   */
  private async sendToTelegram(message: string): Promise<void> {
    try {
      const alertConfig = this.configService.getMonitoringConfig().alertNotifications;
      const botToken = alertConfig.telegramBotToken;
      const chatId = alertConfig.telegramChatId;

      if (!botToken || !chatId) {
        this.logger.warn('Missing Telegram configuration');
        return;
      }

      const url = `https://api.telegram.org/bot${botToken}/sendMessage`;
      await axios.post(url, {
        chat_id: chatId,
        text: message,
        parse_mode: 'Markdown',
      });
      this.logger.debug('Alert sent to Telegram');
    } catch (error) {
      this.logger.error(`Failed to send message to Telegram: ${error.message}`);
    }
  }

  /**
   * Send an alert to a webhook
   */
  private async sendToWebhook(alert: Alert): Promise<void> {
    try {
      const webhookUrl = this.configService.getMonitoringConfig().alertNotifications.webhookUrl;
      if (!webhookUrl) {
        return;
      }

      await axios.post(webhookUrl, {
        type: alert.type,
        title: alert.title,
        message: alert.message,
        timestamp: alert.timestamp,
        component: alert.component || 'system',
      });
      this.logger.debug('Alert sent to webhook');
    } catch (error) {
      this.logger.error(`Failed to send alert to webhook: ${error.message}`);
    }
  }
}
