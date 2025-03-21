/**
 * Alert-related interfaces for monitoring functionality
 */
import { AlertSeverity, AlertCategory } from '@common/utils/alert-manager';

/**
 * Alert notification configuration
 */
export interface AlertNotificationConfig {
  webhookUrl?: string;
  telegramBotToken?: string;
  telegramChatId?: string;
  enableWebhook: boolean;
  enableTelegram: boolean;
  enableDashboard: boolean;
}

/**
 * Alert filter options
 */
export interface AlertFilterOptions {
  severity?: AlertSeverity;
  category?: AlertCategory;
  component?: string;
  since?: number;
  limit?: number;
  acknowledgedOnly?: boolean;
  unacknowledgedOnly?: boolean;
}

/**
 * Alert summary for dashboard
 */
export interface AlertSummary {
  critical: number;
  warning: number;
  info: number;
  recent: {
    id: string;
    severity: AlertSeverity;
    category: AlertCategory;
    component: string;
    title: string;
    timestamp: number;
  }[];
}
