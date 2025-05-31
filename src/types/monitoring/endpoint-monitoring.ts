import { RpcRetryClient } from '@common/utils/rpc-retry-client';

/**
 * Status tracking for primary RPC endpoints
 */
export interface PrimaryEndpointStatus {
  /** The URL of the endpoint */
  url: string;

  /** The chain ID this endpoint belongs to */
  chainId: number;

  /** Timestamp when the endpoint went down, undefined if it's currently up */
  downSince?: number;

  /** Whether an alert has been sent for this downtime */
  alerted: boolean;
}

/**
 * Network configuration for RPC endpoints
 */
export interface NetworkConfig {
  /** Primary RPC endpoint URL */
  primaryEndpoint: string;

  /** Additional RPC endpoints for this network */
  endpoints: string[];

  /** RPC client for making requests */
  client: RpcRetryClient;

  /** Chain ID for this network */
  chainId: number;
}

/**
 * Configuration for block processing
 */
export interface BlockProcessingConfig {
  /** Maximum concurrent block processing jobs */
  maxConcurrent: number;

  /** Maximum retry attempts for failed jobs */
  maxRetries: number;

  /** Delay in milliseconds between retry attempts */
  retryDelayMs: number;

  /** Maximum time allowed for processing before timeout */
  timeoutMs: number;

  /** Batch size for transaction processing */
  txBatchSize: number;
}

/**
 * Configuration for RPC monitoring
 */
export interface RpcMonitorConfig {
  /** Interval for checking RPC endpoints (ms) */
  rpcInterval: number;

  /** Interval for checking port availability (ms) */
  portInterval: number;

  /** Interval for checking services like explorers (ms) */
  serviceInterval: number;

  /** Interval for checking WebSocket endpoints (ms) */
  wsInterval: number;

  /** Interval for syncing with blockchain service (ms) */
  syncInterval: number;

  /** Number of RPC endpoints to check in parallel */
  rpcBatchSize: number;

  /** Number of WebSocket endpoints to check in parallel */
  wsBatchSize: number;

  /** Delay between processing batches (ms) */
  batchDelay: number;

  /** Whether to use adaptive monitoring intervals */
  adaptive: boolean;

  /** Maximum interval for adaptive monitoring (ms) */
  maxInterval: number;

  /** Minimum interval for adaptive monitoring (ms) */
  minInterval: number;
}

/**
 * Status info for an endpoint with downtime tracking
 */
export interface EndpointStatus {
  /** Current status: up, down, or unknown */
  status: 'up' | 'down' | 'unknown';

  /** When the endpoint went down, if applicable */
  downSince?: number;

  /** Whether an alert has been sent for current downtime */
  alerted: boolean;

  /** Response time in milliseconds, if measured */
  latency?: number;
}

/**
 * Valid monitoring types
 */
export type MonitorType = 'rpc' | 'ws' | 'port' | 'service' | 'sync';
