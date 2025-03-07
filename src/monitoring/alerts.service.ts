import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@config/config.service';
import axios from 'axios';
import { MetricsService } from '@metrics/metrics.service';

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

  constructor(
    private readonly configService: ConfigService,
    private readonly metricsService: MetricsService,
  ) {}

  /**
   * Add a new alert and potentially send notifications
   */
  async addAlert(alert: Omit<Alert, 'timestamp'>): Promise<void> {
    const fullAlert: Alert = {
      ...alert,
      timestamp: new Date(),
    };

    this.alerts.push(fullAlert);
    this.logger.warn(`ALERT [${alert.type}]: ${alert.title} - ${alert.message}`);

    // Limit stored alerts to prevent memory issues
    if (this.alerts.length > 100) {
      this.alerts.shift();
    }

    // Send to dashboard if enabled
    if (this.configService.enableDashboardAlerts) {
      this.sendToDashboard(fullAlert);
    }

    // Send to chat channel if enabled
    if (this.configService.enableChatNotifications) {
      await this.sendChatNotification(fullAlert);
    }

    this.metricsService.incrementAlertCount(alert.type, alert.component);
  }

  /**
   * Get recent alerts
   */
  getRecentAlerts(limit: number = 10): Alert[] {
    return this.alerts.slice(-limit);
  }

  /**
   * Send alert to dashboard (would integrate with a real-time dashboard)
   */
  private sendToDashboard(alert: Alert): void {
    // In a real implementation, this might update a database or emit a websocket event
    this.logger.debug(`Dashboard alert: ${alert.title}`);
  }

  /**
   * Send a notification to a chat channel using webhooks
   */
  private async sendChatNotification(alert: Alert): Promise<void> {
    const webhookUrl = this.configService.notificationWebhookUrl;
    const telegramBotToken = this.configService.telegramBotToken;
    const telegramChatId = this.configService.telegramChatId;

    // Always try to use Telegram if credentials are available
    if (telegramBotToken && telegramChatId) {
      await this.sendTelegramNotification(alert, telegramBotToken, telegramChatId);
      // If we have a webhook as well, still send to it for redundancy
      if (webhookUrl) {
        await this.sendWebhookNotification(alert, webhookUrl);
      }
      return;
    }

    // Fall back to webhook if no Telegram credentials are available
    if (!webhookUrl) {
      this.logger.debug('No notification methods configured (neither Telegram nor webhook)');
      return;
    }

    await this.sendWebhookNotification(alert, webhookUrl);
  }

  /**
   * Send notification to a webhook URL
   */
  private async sendWebhookNotification(alert: Alert, webhookUrl: string): Promise<void> {
    try {
      // Format depends on your chat service (Discord, Slack, etc.)
      // This is a generic example
      const payload = {
        content: `**${alert.type.toUpperCase()}**: ${alert.title}`,
        embeds: [
          {
            title: alert.title,
            description: alert.message,
            color: alert.type === 'error' ? 16711680 : alert.type === 'warning' ? 16761600 : 65280,
            fields: [
              {
                name: 'Component',
                value: alert.component || 'System',
              },
              {
                name: 'Time',
                value: alert.timestamp.toISOString(),
              },
            ],
          },
        ],
      };

      await axios.post(webhookUrl, payload);
      this.logger.debug(`Webhook notification sent for alert: ${alert.title}`);
    } catch (error) {
      this.logger.error(`Failed to send webhook notification: ${error.message}`);
    }
  }

  /**
   * Send notification using Telegram API
   */
  private async sendTelegramNotification(alert: Alert, botToken: string, chatId: string): Promise<void> {
    try {
      const apiUrl = `https://api.telegram.org/bot${botToken}/sendMessage`;

      // Get emoji based on alert type
      const emoji = alert.type === 'error' ? '🔴' : alert.type === 'warning' ? '🟠' : '🔵';

      // Format message
      const message =
        `${emoji} *${alert.type.toUpperCase()}*: ${alert.title}\n\n${alert.message}\n\n` +
        `*Component*: ${alert.component || 'System'}\n` +
        `*Time*: ${alert.timestamp.toISOString()}`;

      const payload = {
        chat_id: chatId,
        text: message,
        parse_mode: 'Markdown',
      };

      await axios.post(apiUrl, payload);
      this.logger.debug(`Telegram notification sent for alert: ${alert.title}`);
    } catch (error) {
      this.logger.error(`Failed to send Telegram notification: ${error.message}`);
    }
  }

  /**
   * Create and add an error alert
   */
  async error(title: string, message: string, component?: string): Promise<void> {
    await this.addAlert({
      type: 'error',
      title,
      message,
      component,
    });
  }

  /**
   * Create and add a warning alert
   */
  async warning(title: string, message: string, component?: string): Promise<void> {
    await this.addAlert({
      type: 'warning',
      title,
      message,
      component,
    });
  }

  /**
   * Create and add an info alert
   */
  async info(title: string, message: string, component?: string): Promise<void> {
    await this.addAlert({
      type: 'info',
      title,
      message,
      component,
    });
  }
}
