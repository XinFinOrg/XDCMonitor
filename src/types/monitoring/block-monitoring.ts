/**
 * Information about a block from a specific RPC endpoint
 */
export interface RpcBlockInfo {
  endpoint: string;
  blockNumber: number;
  responseTime: number;
  timestamp: number;
}

/**
 * Complete block data with additional metadata
 */
export interface BlockData {
  chainId: string;
  blockNumber: number;
  timestamp: number;
  parentHash: string;
  hash: string;
  transactions: any[];
  endpoint: string;
  uncles: string[];
  rpcResponse?: any;
}

/**
 * Information about the current state of block monitoring
 */
export interface BlockMonitoringInfo {
  enabled: boolean;
  primaryEndpoint: {
    mainnet: string;
    testnet: string;
  };
  blockTimeThreshold: {
    error: number;
  };
  scanInterval: number;
  monitoredEndpoints: {
    mainnet: NetworkMonitoringData;
    testnet: NetworkMonitoringData;
  };
  blockHeightVariance: {
    mainnet: number;
    testnet: number;
  };
  rpcStatus: {
    mainnet: Record<string, boolean>;
    testnet: Record<string, boolean>;
  };
  queueStats: {
    size: number;
    processing: number;
    completed: number;
  };
  blockTimeStats: {
    mainnet: {
      count: number;
      average: number;
      min?: number;
      max?: number;
      latest?: number;
    };
    testnet: {
      count: number;
      average: number;
      min?: number;
      max?: number;
      latest?: number;
    };
  };
}

/**
 * Network monitoring data structure
 */
export interface NetworkMonitoringData {
  endpoints: string[];
  lastBlockTimestamp?: number;
  consecutiveHighVarianceCount?: number;
  blockHeightVariance?: number;
  rpcBlocks?: Record<string, number>; // Contains the latest block numbers
}
/**
 * Block validation results
 */
export interface BlockValidationResult {
  isValid: boolean;
  errors: string[];
  block?: BlockData;
}

/**
 * Statistics about block processing
 */
export interface BlockProcessingStats {
  totalProcessed: number;
  successfullyProcessed: number;
  failedProcessing: number;
  averageProcessingTime: number;
  lastProcessedBlock: number;
}
