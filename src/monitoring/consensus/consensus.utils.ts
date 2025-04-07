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
    (chainId === 50 ? 'https://rpc.xinfin.network' : 'https://erpc.apothem.network/');

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
 * Checks if the block is the first block of a new epoch or within a new epoch compared to previous state
 *
 * @param currentBlock Current block number
 * @param previousBlocksEpochStart The most recent epoch start block we have recorded
 * @param rpcClient RPC client to use for API calls
 * @returns Promise<{isNewEpoch: boolean, latestEpochBlock: number}> Whether this is a new epoch and the latest epoch boundary
 */
export async function checkEpochTransition(
  currentBlock: number,
  previousEpochBlock: number,
  rpcClient: RpcRetryClient,
): Promise<{ isNewEpoch: boolean; latestEpochBlock: number }> {
  try {
    // Look back 1000 blocks to ensure we catch any epoch transition
    const lookbackBlock = Math.max(1, currentBlock - 1000);

    // Convert block numbers to hex for the RPC call
    const hexCurrentBlock = `0x${currentBlock.toString(16)}`;
    const hexLookbackBlock = `0x${lookbackBlock.toString(16)}`;

    // Get all epoch boundaries in the last 1000 blocks
    const response = await rpcClient.call('XDPoS_getEpochNumbersBetween', [hexLookbackBlock, hexCurrentBlock]);

    if (response && response.result && Array.isArray(response.result) && response.result.length > 0) {
      const epochBoundaries = response.result;
      const latestEpochBlock = epochBoundaries[epochBoundaries.length - 1];

      // If the most recent epoch boundary is newer than what we had before,
      // we've entered a new epoch
      const isNewEpoch = latestEpochBlock > previousEpochBlock;

      return {
        isNewEpoch,
        latestEpochBlock,
      };
    }

    // No epoch boundaries found, so we're still in the same epoch
    return {
      isNewEpoch: false,
      latestEpochBlock: previousEpochBlock,
    };
  } catch (error) {
    console.error(`Error checking for epoch transition: ${error.message}`);
    return {
      isNewEpoch: false,
      latestEpochBlock: previousEpochBlock,
    };
  }
}

/**
 * Gets the next epoch boundary after the specified block
 * @param currentBlock Current block number
 * @param rpcClient RPC client to use for API calls
 * @returns Promise<number> The block number of the next epoch boundary, or 0 if error
 */
export async function getNextEpochBlock(currentBlock: number, rpcClient: RpcRetryClient): Promise<number> {
  try {
    // Look ahead a reasonable number of blocks (1500 should cover at least one epoch)
    const lookAheadBlock = currentBlock + 1500;
    const hexCurrentBlock = `0x${currentBlock.toString(16)}`;
    const hexLookAheadBlock = `0x${lookAheadBlock.toString(16)}`;

    // Use XDPoS_getEpochNumbersBetween to get epoch boundaries ahead
    const response = await rpcClient.call('XDPoS_getEpochNumbersBetween', [hexCurrentBlock, hexLookAheadBlock]);

    if (response && response.result && Array.isArray(response.result) && response.result.length > 0) {
      // Return the first epoch boundary after current block
      return response.result[0];
    }

    // Fallback: if no epoch boundary found in the lookahead window
    return currentBlock + 900; // Approximate with default epoch size
  } catch (error) {
    console.error(`Error getting next epoch block: ${error.message}`);
    return currentBlock + 900; // Fallback to approximate
  }
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
    if (response && response.result) return response.result;
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
      for (const response of batchResponses) {
        if (response && response.result) {
          results.push(response.result);
        }
      }
    }

    return results;
  } catch (error) {
    console.error(`Error fetching block batch: ${error.message}`);
    return [];
  }
}
