/**
 * Common interfaces for monitoring functionality
 */
import { RpcNodeInfo, BlockStats } from './blockchain';
import { AlertSeverity, AlertCategory } from '../utils/alert-manager';

// Generic monitoring result
export interface MonitoringResult<T> {
  timestamp: number;
  success: boolean;
  data?: T;
  error?: Error;
  duration: number; // in milliseconds
  endpoint?: string; // URL or identifier of the monitored service
}

// Monitoring status
export interface MonitoringStatus {
  isActive: boolean;
  lastRun: number; // timestamp
  nextRun: number; // timestamp
  runCount: number;
  errorCount: number;
  successRate: number; // 0 to 1
}

// Block monitoring status
export interface BlockMonitoringStatus extends MonitoringStatus {
  latestBlock?: number;
  averageBlockTime?: number; // in seconds
  missedBlocks?: number;
  networkSyncStatus?: NetworkSyncStatus;
}

// Network synchronization status
export interface NetworkSyncStatus {
  isSynced: boolean;
  highestBlock: number;
  currentBlock: number;
  blocksRemaining: number;
}

// RPC monitoring status
export interface RpcMonitoringStatus extends MonitoringStatus {
  endpoints: RpcNodeInfo[];
  averageLatency?: number; // in milliseconds
}

// Transaction monitoring status
export interface TransactionMonitoringStatus extends MonitoringStatus {
  transactionsPerSecond?: number;
  averageGasPrice?: bigint;
  pendingTransactions?: number;
}

// Monitoring service interface
export interface MonitoringService<T extends MonitoringStatus> {
  getStatus(): T;
  start(): Promise<void>;
  stop(): Promise<void>;
  isRunning(): boolean;
}

// Alert notification configuration
export interface AlertNotificationConfig {
  webhookUrl?: string;
  telegramBotToken?: string;
  telegramChatId?: string;
  enableWebhook: boolean;
  enableTelegram: boolean;
  enableDashboard: boolean;
}

// Alert filter options
export interface AlertFilterOptions {
  severity?: AlertSeverity;
  category?: AlertCategory;
  component?: string;
  since?: number;
  limit?: number;
  acknowledgedOnly?: boolean;
  unacknowledgedOnly?: boolean;
}

// Dashboard data structure
export interface DashboardData {
  blockMonitoring: BlockMonitoringStatus;
  rpcMonitoring: RpcMonitoringStatus;
  transactionMonitoring: TransactionMonitoringStatus;
  recentBlocks: BlockStats[];
  alerts: AlertSummary;
  updatedAt: number;
}

// Alert summary for dashboard
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

// Monitoring configuration
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

// InfluxDB metrics configuration
export interface InfluxDbConfig {
  url: string;
  token: string;
  org: string;
  bucket: string;
  enabled: boolean;
  adminUser?: string;
  adminPassword?: string;
}

// Performance metrics collected
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
