/**
 * Monitoring status interfaces
 */
import { RpcNodeInfo } from '../blockchain/node';

/**
 * Generic monitoring status
 */
export interface MonitoringStatus {
  isActive: boolean;
  lastRun: number; // timestamp
  nextRun: number; // timestamp
  runCount: number;
  errorCount: number;
  successRate: number; // 0 to 1
}

/**
 * Block monitoring status
 */
export interface BlockMonitoringStatus extends MonitoringStatus {
  latestBlock?: number;
  averageBlockTime?: number; // in seconds
  missedBlocks?: number;
  networkSyncStatus?: NetworkSyncStatus;
}

/**
 * Network synchronization status
 */
export interface NetworkSyncStatus {
  isSynced: boolean;
  highestBlock: number;
  currentBlock: number;
  blocksRemaining: number;
}

/**
 * RPC monitoring status
 */
export interface RpcMonitoringStatus extends MonitoringStatus {
  endpoints: RpcNodeInfo[];
  averageLatency?: number; // in milliseconds
}

/**
 * Transaction monitoring status
 */
export interface TransactionMonitoringStatus extends MonitoringStatus {
  transactionsPerSecond?: number;
  averageGasPrice?: bigint;
  pendingTransactions?: number;
}
