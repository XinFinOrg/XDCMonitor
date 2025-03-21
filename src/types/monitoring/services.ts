/**
 * Interfaces for monitoring services
 */
import { BlockMonitoringStatus, MonitoringStatus, RpcMonitoringStatus, TransactionMonitoringStatus } from './status';
import { AlertSummary } from './alerts';
import { BlockStats } from '../blockchain/stats';

/**
 * Monitoring service interface
 */
export interface MonitoringService<T extends MonitoringStatus> {
  getStatus(): T;
  start(): Promise<void>;
  stop(): Promise<void>;
  isRunning(): boolean;
}

/**
 * Dashboard data structure
 */
export interface DashboardData {
  blockMonitoring: BlockMonitoringStatus;
  rpcMonitoring: RpcMonitoringStatus;
  transactionMonitoring: TransactionMonitoringStatus;
  recentBlocks: BlockStats[];
  alerts: AlertSummary;
  updatedAt: number;
}
