import { ALERTS } from '@common/constants/config';
import { AlertCategory, AlertManager, Alert as AlertManagerAlert, AlertSeverity } from '@common/utils/alert-manager';
import { ConfigService } from '@config/config.service';
import { MetricsService } from '@metrics/metrics.service';
import { Injectable, Logger } from '@nestjs/common';
import axios from 'axios';

export interface Alert {
  type: 'error' | 'warning' | 'info';
  title: string;
  message: string;
  timestamp: Date;
  component?: string;
}

@Injectable()
export class AlertsService {
  private readonly logger = new Logger(AlertsService.name);
  private alerts: Alert[] = [];
  private alertThrottling: Record<string, number> = {};

  constructor(
    private readonly configService: ConfigService,
    private readonly metricsService: MetricsService,
    private readonly alertManager: AlertManager,
  ) {
    this.initializeAlertManager();
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
  async addAlert(alert: Omit<Alert, 'timestamp'>): Promise<void> {
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

    // Record metric for the alert
    if (alert.component) {
      this.metricsService.incrementAlertCount(alert.type, alert.component);
    }
  }

  /**
   * Create an error-level alert
   */
  async error(alertType: string, component: string, message: string): Promise<void> {
    if (this.shouldThrottle(alertType)) {
      this.logger.debug(`Throttling error alert: ${alertType}`);
      return;
    }

    await this.addAlert({
      type: 'error',
      component,
      title: this.formatAlertTitle(alertType),
      message,
    });
  }

  /**
   * Create a warning-level alert
   * NOTE: This method is disabled as per requirement to turn off warning alerts
   */
  async warning(alertType: string, component: string, message: string): Promise<void> {
    // Warnings are disabled - only log to debug
    this.logger.debug(`WARNING ALERT SUPPRESSED: ${alertType} - ${message}`);
    return;
  }

  /**
   * Create an info-level alert
   */
  async info(alertType: string, component: string, message: string): Promise<void> {
    if (this.shouldThrottle(alertType)) {
      this.logger.debug(`Throttling info alert: ${alertType}`);
      return;
    }

    await this.addAlert({
      type: 'info',
      component,
      title: this.formatAlertTitle(alertType),
      message,
    });
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
  ): Promise<void> {
    const message = `Current value: ${currentValue}${unit} (Threshold: ${thresholdValue}${unit})`;

    switch (severity) {
      case 'error':
        await this.error('threshold_exceeded', component, `${title} - ${message}`);
        break;
      case 'warning':
        // Warning alerts are disabled - only log to debug
        this.logger.debug(`WARNING THRESHOLD SUPPRESSED: ${title} - ${message}`);
        break;
      case 'info':
        await this.info('threshold_notification', component, `${title} - ${message}`);
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
