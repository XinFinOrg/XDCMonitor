import { BlockInfo } from '@models/block.interface';

/**
 * Block processing job with chain information
 */
export interface BlockProcessingJob {
  /**
   * The block to process
   */
  block: BlockInfo | null;

  /**
   * The chain ID this block belongs to
   */
  chainId: number;

  /**
   * The block number to process
   */
  blockNumber?: number;

  /**
   * RPC endpoint to use for processing
   */
  endpoint?: string;

  /**
   * Time when the job was created
   */
  timestamp?: number;

  /**
   * Priority of the job
   */
  priority?: number;
}
