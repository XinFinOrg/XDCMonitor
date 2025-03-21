/**
 * Blockchain statistics interfaces
 */

/**
 * Block statistics data
 */
export interface BlockStats {
  blockNumber: number;
  timestamp: number;
  transactionCount: number;
  gasUsed: bigint;
  gasLimit: bigint;
  baseFeePerGas?: bigint;
  blockTime?: number; // Time since last block
  blockSize: number;
  uncleCount: number;
}
