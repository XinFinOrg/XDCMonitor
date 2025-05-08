import { ENV_VARS, FEATURE_FLAGS } from '@common/constants/config';
import { RpcRetryClient } from '@common/utils/rpc-retry-client';
import { ConfigService } from '@config/config.service';

// Constants
export const TIMEOUT_THRESHOLD = 10; // 10 seconds timeout for miners
export const DEFAULT_SCAN_INTERVAL_MS = 15000; // Default: 15 seconds

/**
 * Creates an RPC client for the consensus monitoring
 */
export function createRpcClient(configService: ConfigService, chainId: number = 50): RpcRetryClient {
  const rpcUrl =
    configService.getPrimaryRpcUrl(chainId) ||
    (chainId === 50 ? 'http://173.212.233.170:8989' : 'http://157.173.195.189:8555');

  return new RpcRetryClient(rpcUrl, {
    maxRetries: 3,
    retryDelayMs: 1000,
    timeoutMs: 30000,
  });
}

/**
 * Get monitoring configuration
 */
export function getMonitoringConfig(configService: ConfigService): {
  enabled: boolean;
  scanIntervalMs: number;
  chains: number[];
} {
  return {
    enabled: configService.isFeatureEnabled(FEATURE_FLAGS.ENABLE_CONSENSUS_MONITORING, false),
    scanIntervalMs: configService.getNumber(ENV_VARS.CONSENSUS_SCAN_INTERVAL, DEFAULT_SCAN_INTERVAL_MS),
    chains: configService.getNumberArray(ENV_VARS.CONSENSUS_MONITORING_CHAIN_IDS, [50, 51]),
  };
}

/**
 * Gets missed rounds information for the current epoch
 * @param rpcClient RPC client to use for API calls
 * @param blockNumber Optional block number to query (defaults to 'latest')
 * @returns Promise<any> The missed rounds data or null if error
 */
export async function getMissedRoundsForEpoch(
  rpcClient: RpcRetryClient,
  blockNumber: string | number = 'latest',
): Promise<{
  EpochRound: number;
  EpochBlockNumber: number;
  MissedRounds: Array<{
    Round: number;
    Miner: string;
    CurrentBlockHash: string;
    CurrentBlockNum: number;
    ParentBlockHash: string;
    ParentBlockNum: number;
  }>;
} | null> {
  try {
    const response = await rpcClient.call('XDPoS_getMissedRoundsInEpochByBlockNum', [blockNumber]);
    if (response) return response;
    return null;
  } catch (error) {
    console.error(`Error getting missed rounds: ${error.message}`);
    return null;
  }
}

/**
 * Fetches a batch of blocks efficiently to allow checking multiple blocks
 * @param rpcClient RPC client to use for API calls
 * @param startBlock Start block number
 * @param endBlock End block number
 * @param batchSize Size of each batch request (default: 20)
 * @param includeTxs Whether to include full transaction data (default: false)
 * @returns Promise<Array<any>> Array of block objects
 */
export async function fetchBlockBatch(
  rpcClient: RpcRetryClient,
  startBlock: number,
  endBlock: number,
  batchSize: number = 20,
  includeTxs: boolean = false,
): Promise<Array<any>> {
  try {
    const results: any[] = [];

    // Process in batches to avoid overwhelming the RPC node
    for (let i = startBlock; i <= endBlock; i += batchSize) {
      const batchEnd = Math.min(i + batchSize - 1, endBlock);
      const batchPromises = [];

      // Create a batch of promises for parallel processing
      for (let blockNum = i; blockNum <= batchEnd; blockNum++) {
        const blockHex = `0x${blockNum.toString(16)}`;
        batchPromises.push(rpcClient.call('eth_getBlockByNumber', [blockHex, includeTxs]));
      }

      // Wait for all promises in this batch to resolve
      const batchResponses = await Promise.all(batchPromises);

      // Process responses
      for (const response of batchResponses) if (response) results.push(response);
    }

    return results;
  } catch (error) {
    console.error(`Error fetching block batch: ${error.message}`);
    return [];
  }
}

/**
 * Calculate epoch number
 * @param round Round number to calculate epoch number for
 * @param chainId Chain ID to use for calculation
 * @returns Epoch number
 */
export function calculateEpochNumber(round: number, chainId: number): number {
  /**
   * epochNum := x.config.V2.SwitchEpoch + uint64(epochSwitchInfo.EpochSwitchBlockInfo.Round)/x.config.Epoch
   * - SwitchEpoch:       common.MaintnetConstant.TIPV2SwitchBlock.Uint64() / 900,
   * - TIPV2SwitchBlock:  big.NewInt(80370000), // Target 2nd Oct 2024  ( chainId 50)
   * - TIPV2SwitchBlock:  big.NewInt(56828700), // Target 13rd Nov 2023 ( chainId 51)
   * - x.config.Epoch:    900
   */

  const switchBlock = chainId === 50 ? 80370000 : 56828700;
  return Math.floor(switchBlock / 900) + Math.floor(round / 900);
}
