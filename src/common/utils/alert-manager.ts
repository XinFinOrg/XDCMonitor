import { Injectable, Logger } from '@nestjs/common';
import axios from 'axios';
import TelegramBot from 'node-telegram-bot-api';

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
  chainId?: number;
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
      metadata: options.metadata || {},
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
    const { botToken, chatId, mainnetTopicId, testnetTopicId } = channel.config;

    if (!botToken || !chatId) {
      throw new Error('Telegram bot token or chat ID is not configured');
    }

    // Format message for Telegram
    const severityEmoji =
      alert.severity === AlertSeverity.CRITICAL ? '🔴' : alert.severity === AlertSeverity.WARNING ? '⚠️' : '🔵';

    const message = `${severityEmoji} *${alert.title}*\n\n${alert.message}\n\n📱 *Component:* ${
      alert.component
    }\n🔍 *Category:* ${alert.category}\n⏰ *Time:* ${new Date(alert.timestamp).toLocaleString()}`;

    try {
      // Create a new bot instance with polling disabled
      const bot = new TelegramBot(botToken, {
        polling: false,
        // Fix for EFATAL: AggregateError - force IPv4
        request: {
          // Proper type for the request options
          agentClass: require('https').Agent,
          agentOptions: {
            keepAlive: true,
            family: 4, // Force IPv4
          },
        } as any, // Use type assertion to bypass type checking issues
      });

      // Extract chainId from metadata if available
      const chainId = alert.metadata?.chainId as number | undefined;

      // Determine message thread ID based on chainId
      let messageThreadId: string | undefined;
      if (chainId === 50 && mainnetTopicId) {
        messageThreadId = mainnetTopicId;
        this.logger.debug(`Using Mainnet topic ID: ${messageThreadId}`);
      } else if (chainId === 51 && testnetTopicId) {
        messageThreadId = testnetTopicId;
        this.logger.debug(`Using Testnet topic ID: ${messageThreadId}`);
      }

      // Create options object with optional message_thread_id
      const options: TelegramBot.SendMessageOptions = {
        parse_mode: 'Markdown',
      };

      if (messageThreadId) {
        options.message_thread_id = parseInt(messageThreadId, 10);
      }

      // Send the message with retry logic
      const result = await this.sendTelegramMessageSafely(bot, chatId, message, options);

      if (result) {
        this.logger.debug(`Telegram notification sent, message ID: ${result.message_id}`);
      } else {
        // If all retries with the bot lib failed, try the direct HTTP fallback method
        this.logger.debug('All retries failed with bot library, attempting fallback HTTP method');
        const fallbackResult = await this.sendTelegramFallback(botToken, chatId, message, 'Markdown', messageThreadId);

        if (fallbackResult) {
          this.logger.debug('Telegram notification sent using fallback HTTP method');
        } else {
          // If even the fallback failed, try one more time with plain text
          const plainTextResult = await this.sendTelegramFallback(
            botToken,
            chatId,
            message
              .replace(/\*/g, '')
              .replace(/📱 [*]Component:[*]/g, '📱 Component:')
              .replace(/🔍 [*]Category:[*]/g, '🔍 Category:')
              .replace(/⏰ [*]Time:[*]/g, '⏰ Time:'),
            undefined,
            messageThreadId,
          );

          if (plainTextResult) {
            this.logger.debug('Telegram notification sent using fallback HTTP method with plain text');
          } else {
            throw new Error('Failed to send Telegram message after all retry methods');
          }
        }
      }
    } catch (error) {
      this.logger.error(`Failed to send Telegram notification: ${(error as Error).message}`);
      this.logger.debug(`Telegram error stack: ${(error as Error).stack}`);
      throw error;
    }
  }

  /**
   * Fallback method to send Telegram messages using direct HTTP API calls
   * when the node-telegram-bot-api fails
   */
  private async sendTelegramFallback(
    botToken: string,
    chatId: string | number,
    text: string,
    parseMode?: string,
    messageThreadId?: string,
  ): Promise<boolean> {
    try {
      this.logger.debug('Attempting to send message using fallback HTTP method');

      // Simple text cleanup
      const cleanText = text.replace(/\*/g, '');

      // Create the request URL
      const apiUrl = `https://api.telegram.org/bot${botToken}/sendMessage`;

      // Prepare the request data
      const data: any = {
        chat_id: chatId,
        text: cleanText,
        disable_web_page_preview: true,
      };

      // Only add parse_mode if specified
      if (parseMode) {
        data.parse_mode = parseMode;
      }

      // Add message_thread_id if specified
      if (messageThreadId) {
        data.message_thread_id = parseInt(messageThreadId, 10);
      }

      // Send the request with axios
      const response = await axios.post(apiUrl, data, {
        // Force IPv4 for the HTTP request
        httpsAgent: new (require('https').Agent)({
          family: 4,
          keepAlive: true,
          timeout: 10000,
        }),
        timeout: 10000,
      });

      if (response.status === 200 && response.data && response.data.ok) {
        this.logger.debug('Successfully sent message using fallback HTTP method');
        return true;
      } else {
        this.logger.warn(`Fallback HTTP method failed with status: ${response.status}`);
        return false;
      }
    } catch (error) {
      this.logger.error(`Fallback HTTP method also failed: ${(error as Error).message}`);
      return false;
    }
  }

  /**
   * Helper function to safely send Telegram messages with retries
   * @param bot - The Telegram bot instance
   * @param chatId - The chat to send message to
   * @param text - Message text
   * @param options - Additional options
   * @param retryCount - Current retry attempt
   */
  private async sendTelegramMessageSafely(
    bot: TelegramBot,
    chatId: string | number,
    text: string,
    options: TelegramBot.SendMessageOptions = { parse_mode: 'Markdown' },
    retryCount = 0,
  ): Promise<TelegramBot.Message | null> {
    try {
      return await bot.sendMessage(chatId, text, options);
    } catch (error) {
      const errorMessage = (error as Error).message || 'Unknown error';
      this.logger.warn(`Failed to send Telegram message to ${chatId}: ${errorMessage}`);

      // Log more details about the error
      if (error instanceof Error && error.stack) {
        this.logger.debug(`Telegram error details: ${error.stack}`);
      }

      // Network errors may need more time before retry
      const isNetworkError =
        errorMessage.includes('ETIMEDOUT') ||
        errorMessage.includes('ECONNRESET') ||
        errorMessage.includes('ECONNREFUSED') ||
        errorMessage.includes('EFATAL') ||
        errorMessage.includes('AggregateError');

      const retryDelay = isNetworkError ? 3000 * (retryCount + 1) : 1000 * (retryCount + 1);

      if (retryCount < 3) {
        this.logger.debug(`Retrying Telegram message send (attempt ${retryCount + 1}) in ${retryDelay}ms...`);
        await new Promise(resolve => setTimeout(resolve, retryDelay));

        // Try with a simpler message format on second retry to avoid formatting issues
        if (retryCount >= 1) {
          // Simplify the message format
          const plainText = text.replace(/\*/g, '').replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');

          return this.sendTelegramMessageSafely(bot, chatId, plainText, { parse_mode: undefined }, retryCount + 1);
        }

        return this.sendTelegramMessageSafely(bot, chatId, text, options, retryCount + 1);
      }

      if (options && options.parse_mode === 'Markdown') {
        try {
          // Try without special formatting on final attempt
          this.logger.debug('Attempting final retry without Markdown formatting');
          // Send a simplified message with no formatting
          const plainText = text
            .replace(/\*/g, '')
            .replace(/📱 \*Component:\*/g, '📱 Component:')
            .replace(/🔍 \*Category:\*/g, '🔍 Category:')
            .replace(/⏰ \*Time:\*/g, '⏰ Time:');

          return await bot.sendMessage(chatId, plainText, { parse_mode: undefined });
        } catch (innerError) {
          this.logger.error(`Final Telegram retry also failed: ${(innerError as Error).message}`);
        }
      }
      return null;
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
