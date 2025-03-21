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
 * Performance metrics collected
 */
export interface PerformanceMetrics {
  memoryUsage: {
    rss: number;
    heapTotal: number;
    heapUsed: number;
    external: number;
  };
  cpuUsage: {
    user: number;
    system: number;
  };
  uptime: number; // in seconds
  loadAverage: number[];
}

/**
 * Generic monitoring result
 */
export interface MonitoringResult<T> {
  timestamp: number;
  success: boolean;
  data?: T;
  error?: Error;
  duration: number; // in milliseconds
  endpoint?: string; // URL or identifier of the monitored service
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
