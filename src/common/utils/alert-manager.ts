import { Injectable, Logger } from '@nestjs/common';
import axios from 'axios';

export enum AlertSeverity {
  INFO = 'info',
  WARNING = 'warning',
  CRITICAL = 'critical',
}

export enum AlertCategory {
  BLOCKCHAIN = 'blockchain',
  SYSTEM = 'system',
  PERFORMANCE = 'performance',
  SECURITY = 'security',
  INFRASTRUCTURE = 'infrastructure',
}

export interface AlertOptions {
  severity: AlertSeverity;
  category: AlertCategory;
  component: string;
  title: string;
  message: string;
  timestamp?: number;
  metadata?: Record<string, any>;
  shouldNotify?: boolean;
  notificationChannels?: string[];
}

export interface Alert extends AlertOptions {
  id: string;
  timestamp: number;
  acknowledged: boolean;
  resolvedAt?: number;
}

export interface NotificationChannel {
  id: string;
  name: string;
  type: 'webhook' | 'telegram' | 'email' | 'dashboard';
  enabled: boolean;
  config: Record<string, any>;
}

@Injectable()
export class AlertManager {
  private alerts: Alert[] = [];
  private notificationChannels: NotificationChannel[] = [];
  private readonly logger = new Logger(AlertManager.name);

  // Max alerts to keep in memory
  private readonly maxAlerts = 1000;

  constructor() {}

  /**
   * Configure notification channels
   */
  configureNotificationChannels(channels: NotificationChannel[]): void {
    this.notificationChannels = channels;
    this.logger.log(`Configured ${channels.length} notification channels`);
  }

  /**
   * Add an alert to the system
   */
  addAlert(options: AlertOptions): Alert {
    const timestamp = options.timestamp || Date.now();
    const id = `${timestamp}-${options.category}-${options.component}-${Math.random().toString(36).substr(2, 5)}`;

    const alert: Alert = {
      id,
      ...options,
      timestamp,
      acknowledged: false,
    };

    // Add to alerts array (and maintain size limit)
    this.alerts.unshift(alert);
    if (this.alerts.length > this.maxAlerts) {
      this.alerts = this.alerts.slice(0, this.maxAlerts);
    }

    // Log the alert
    const logMethod =
      options.severity === AlertSeverity.CRITICAL
        ? this.logger.error.bind(this.logger)
        : options.severity === AlertSeverity.WARNING
          ? this.logger.warn.bind(this.logger)
          : this.logger.log.bind(this.logger);

    logMethod(`${options.severity.toUpperCase()} [${options.category}] ${options.title}: ${options.message}`);

    // Send notifications if required
    if (options.shouldNotify !== false) {
      this.sendNotifications(alert, options.notificationChannels);
    }

    return alert;
  }

  /**
   * Get all alerts, optionally filtered
   */
  getAlerts(filter?: {
    severity?: AlertSeverity;
    category?: AlertCategory;
    component?: string;
    acknowledgedOnly?: boolean;
    unacknowledgedOnly?: boolean;
    since?: number;
  }): Alert[] {
    let filteredAlerts = this.alerts;

    if (filter) {
      if (filter.severity) {
        filteredAlerts = filteredAlerts.filter(a => a.severity === filter.severity);
      }

      if (filter.category) {
        filteredAlerts = filteredAlerts.filter(a => a.category === filter.category);
      }

      if (filter.component) {
        filteredAlerts = filteredAlerts.filter(a => a.component === filter.component);
      }

      if (filter.acknowledgedOnly) {
        filteredAlerts = filteredAlerts.filter(a => a.acknowledged);
      }

      if (filter.unacknowledgedOnly) {
        filteredAlerts = filteredAlerts.filter(a => !a.acknowledged);
      }

      if (filter.since) {
        filteredAlerts = filteredAlerts.filter(a => a.timestamp >= filter.since);
      }
    }

    return filteredAlerts;
  }

  /**
   * Acknowledge an alert
   */
  acknowledgeAlert(alertId: string): boolean {
    const alert = this.alerts.find(a => a.id === alertId);
    if (!alert) {
      return false;
    }

    alert.acknowledged = true;
    return true;
  }

  /**
   * Mark an alert as resolved
   */
  resolveAlert(alertId: string): boolean {
    const alert = this.alerts.find(a => a.id === alertId);
    if (!alert) {
      return false;
    }

    alert.resolvedAt = Date.now();
    return true;
  }

  /**
   * Send notifications about an alert to specified channels or all enabled channels
   */
  private async sendNotifications(alert: Alert, specificChannels?: string[]): Promise<void> {
    // Filter channels to those that are enabled and match the specific channels (if provided)
    const channels = this.notificationChannels.filter(
      channel => channel.enabled && (!specificChannels || specificChannels.includes(channel.id)),
    );

    if (channels.length === 0) {
      return;
    }

    // Send to each channel
    for (const channel of channels) {
      try {
        await this.sendToChannel(alert, channel);
      } catch (error) {
        this.logger.error(
          `Failed to send alert to ${channel.type} channel ${channel.id}: ${(error as Error).message}`,
          (error as Error).stack,
        );
      }
    }
  }

  /**
   * Send an alert to a specific notification channel
   */
  private async sendToChannel(alert: Alert, channel: NotificationChannel): Promise<void> {
    switch (channel.type) {
      case 'webhook':
        await this.sendWebhook(alert, channel);
        break;
      case 'telegram':
        await this.sendTelegram(alert, channel);
        break;
      case 'email':
        await this.sendEmail(alert, channel);
        break;
      case 'dashboard':
        // Dashboard notifications are handled automatically by the frontend
        break;
      default:
        this.logger.warn(`Unsupported notification channel type: ${(channel as any).type}`);
    }
  }

  /**
   * Send an alert via webhook
   */
  private async sendWebhook(alert: Alert, channel: NotificationChannel): Promise<void> {
    const { url, headers } = channel.config;

    if (!url) {
      throw new Error('Webhook URL is not configured');
    }

    const payload = {
      alert: {
        id: alert.id,
        severity: alert.severity,
        category: alert.category,
        component: alert.component,
        title: alert.title,
        message: alert.message,
        timestamp: alert.timestamp,
        metadata: alert.metadata,
      },
    };

    try {
      const response = await axios.post(url, payload, { headers });
      this.logger.debug(`Webhook notification sent to ${url}, status: ${response.status}`);
    } catch (error) {
      throw new Error(`Webhook error: ${(error as Error).message}`);
    }
  }

  /**
   * Send an alert via Telegram
   */
  private async sendTelegram(alert: Alert, channel: NotificationChannel): Promise<void> {
    const { botToken, chatId } = channel.config;

    if (!botToken || !chatId) {
      throw new Error('Telegram bot token or chat ID is not configured');
    }

    // Format the message
    const severity =
      alert.severity === AlertSeverity.CRITICAL
        ? '🔴 CRITICAL'
        : alert.severity === AlertSeverity.WARNING
          ? '🟠 WARNING'
          : '🔵 INFO';

    const message = `${severity}: ${alert.title}\n\n${alert.message}\n\nComponent: ${alert.component}\nCategory: ${alert.category}`;

    const url = `https://api.telegram.org/bot${botToken}/sendMessage`;
    const payload = {
      chat_id: chatId,
      text: message,
      parse_mode: 'Markdown',
    };

    try {
      const response = await axios.post(url, payload);
      this.logger.debug(`Telegram notification sent, message ID: ${response.data?.result?.message_id}`);
    } catch (error) {
      throw new Error(`Telegram error: ${(error as Error).message}`);
    }
  }

  /**
   * Send an alert via email
   */
  private async sendEmail(alert: Alert, channel: NotificationChannel): Promise<void> {
    // Email implementation would go here - typically using a service like SendGrid, AWS SES, etc.
    this.logger.debug('Email sending is not implemented yet');
  }
}
