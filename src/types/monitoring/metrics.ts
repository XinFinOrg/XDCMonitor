import { AlertNotificationConfig } from './alerts';

/**
 * Metrics-related interfaces for monitoring
 */

/**
 * InfluxDB metrics configuration
 */
export interface InfluxDbConfig {
  url: string;
  token: string;
  org: string;
  bucket: string;
  enabled: boolean;
  adminUser?: string;
  adminPassword?: string;
}

/**
 * Monitoring configuration
 */
export interface MonitoringConfig {
  scanIntervalMs: number;
  blocksToScan: number;
  enableBlocksMonitoring: boolean;
  enableTransactionsMonitoring: boolean;
  enableRpcMonitoring: boolean;
  enableMetricsCollection: boolean;
  enableAlerts: boolean;
  alertNotifications: AlertNotificationConfig;
  slowRpcThresholdMs: number;
  blockDiscrepancySyncThreshold: number;
  transactionHistoryWindowMs: number;
}
