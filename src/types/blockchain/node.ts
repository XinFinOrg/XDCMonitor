/**
 * Blockchain node interfaces
 */

/**
 * Network information
 */
export interface NetworkInfo {
  chainId: number;
  networkName: string;
  isMainnet: boolean;
  latestBlock: number;
  averageBlockTime: number; // in seconds
}

/**
 * RPC node information
 */
export interface RpcNodeInfo {
  url: string;
  isActive: boolean;
  latestBlock?: number;
  responseTime?: number; // in ms
  successRate?: number; // 0 to 1
}
