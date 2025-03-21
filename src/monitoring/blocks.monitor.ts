import { BlockchainService } from '@blockchain/blockchain.service';
import { ConfigService } from '@config/config.service';
import { MetricsService } from '@metrics/metrics.service';
import { BlockInfo, BlockProcessingJob, TransactionStatus } from '@types';
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import {
  CHAIN_ID_TO_NAME,
  CHAIN_ID_TO_NETWORK,
  NETWORK_MAINNET,
  NETWORK_TESTNET,
  RECENT_BLOCKS_SAMPLE_SIZE,
  TRANSACTION_HISTORY_WINDOW_MS,
} from '../common/constants/block-monitoring';
import { ALERTS, BLOCKCHAIN, PERFORMANCE } from '@common/constants/config';
import { MAINNET_CHAIN_ID, TESTNET_CHAIN_ID } from '@common/constants/endpoints';
import { EnhancedQueue, Priority } from '@common/utils/enhanced-queue';
import { RpcRetryClient } from '@common/utils/rpc-retry-client';
import { TimeWindowData } from '@common/utils/time-window-data';
import { AlertsService } from '@monitoring/alerts.service';
import { RpcMonitorService } from '@monitoring/rpc.monitor';

interface RpcBlockInfo {
  endpoint: string;
  blockNumber: number;
  responseTime: number;
  timestamp: number;
}

// Define interfaces for our data structures
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
    mainnet: string[];
    testnet: string[];
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
      latest?: number;
      average: number;
      min?: number;
      max?: number;
    };
    testnet: {
      count: number;
      latest?: number;
      average: number;
      min?: number;
      max?: number;
    };
  };
}

/**
 * Service for monitoring blocks across XDC networks
 */
@Injectable()
export class BlocksMonitorService implements OnModuleInit {
  private readonly logger = new Logger(BlocksMonitorService.name);
  private monitoringEnabled = false;
  private scanIntervalMs: number;
  private mainnetPrimaryEndpoint: string;
  private testnetPrimaryEndpoint: string;
  private mainnetEndpoints: string[] = [];
  private testnetEndpoints: string[] = [];
  private mainnetLatestBlock = 0;
  private testnetLatestBlock = 0;

  // Track the last time we processed blocks to calculate time between blocks
  private lastBlockTimes: Record<string, number> = {};

  // Track RPC block information
  private rpcBlockInfo: Map<string, RpcBlockInfo> = new Map();

  private lastHighestBlockMainnet: number = 0;
  private lastHighestBlockTestnet: number = 0;

  // Store recent block times for calculating averages using TimeWindowData
  private recentBlockTimes: { [network: string]: TimeWindowData } = {
    [NETWORK_MAINNET]: new TimeWindowData({
      windowDurationMs: 24 * 60 * 60 * 1000, // 24 hours
      maxDataPoints: RECENT_BLOCKS_SAMPLE_SIZE,
    }),
    [NETWORK_TESTNET]: new TimeWindowData({
      windowDurationMs: 24 * 60 * 60 * 1000, // 24 hours
      maxDataPoints: RECENT_BLOCKS_SAMPLE_SIZE,
    }),
  };

  // Use TimeWindowData for transaction tracking
  private transactionCounts: { [network: string]: TimeWindowData } = {
    [NETWORK_MAINNET]: new TimeWindowData({
      windowDurationMs: TRANSACTION_HISTORY_WINDOW_MS,
      maxDataPoints: RECENT_BLOCKS_SAMPLE_SIZE,
    }),
    [NETWORK_TESTNET]: new TimeWindowData({
      windowDurationMs: TRANSACTION_HISTORY_WINDOW_MS,
      maxDataPoints: RECENT_BLOCKS_SAMPLE_SIZE,
    }),
  };

  private failedTransactions: { [network: string]: TimeWindowData } = {
    [NETWORK_MAINNET]: new TimeWindowData({
      windowDurationMs: TRANSACTION_HISTORY_WINDOW_MS,
      maxDataPoints: RECENT_BLOCKS_SAMPLE_SIZE,
    }),
    [NETWORK_TESTNET]: new TimeWindowData({
      windowDurationMs: TRANSACTION_HISTORY_WINDOW_MS,
      maxDataPoints: RECENT_BLOCKS_SAMPLE_SIZE,
    }),
  };

  // Enhanced block processing queue
  private blockProcessingQueue: EnhancedQueue<BlockProcessingJob>;

  // Client for each chain
  private mainnetClient: RpcRetryClient;
  private testnetClient: RpcRetryClient;

  private initialBlockProcessed = false;

  constructor(
    private readonly blockchainService: BlockchainService,
    private readonly configService: ConfigService,
    private readonly rpcMonitorService: RpcMonitorService,
    private readonly metricsService: MetricsService,
    private readonly alertsService: AlertsService,
  ) {
    // Initialize the enhanced block processing queue with improved reliability
    this.blockProcessingQueue = new EnhancedQueue<BlockProcessingJob>(this.processBlockJob.bind(this), {
      maxConcurrent: 3, // Process up to 3 blocks concurrently
      maxRetries: 3, // Retry failed blocks up to 3 times
      retryDelayMs: 2000, // Wait 2 seconds between retries
      processingTimeoutMs: 60000, // 1 minute timeout for processing
      getItemId: job => {
        // Safely handle both cases where block is null or has a number
        if (job.block && job.block.number !== undefined) {
          return `${job.chainId}-${job.block.number}`;
        }
        // Use blockNumber when block object is null
        if (job.blockNumber !== undefined) {
          return `${job.chainId}-${job.blockNumber}`;
        }
        // Fallback to timestamp if nothing else is available
        return `${job.chainId}-${job.timestamp || Date.now()}`;
      },
      onSuccess: (job, result) => {
        // Safely access block number from either job.block or job.blockNumber
        const blockNum = job.block?.number || job.blockNumber;
        this.logger.debug(`Successfully processed block #${blockNum} on chain ${job.chainId}`);
      },
      onError: (job, error, attempts) => {
        // Safely access block number from either job.block or job.blockNumber
        const blockNum = job.block?.number || job.blockNumber;
        this.logger.warn(
          `Error processing block #${blockNum} on chain ${job.chainId} (attempt ${attempts}): ${error.message}`,
        );
      },
      onMaxRetries: (job, error, attempts) => {
        // Safely access block number from either job.block or job.blockNumber
        const blockNum = job.block?.number || job.blockNumber;
        this.logger.error(
          `Failed to process block #${blockNum} on chain ${job.chainId} after ${attempts} attempts: ${error.message}`,
        );
        // Create an alert for persistent block processing failures
        this.alertsService.error(`Failed to process block #${blockNum}`, error.message, 'blockchain');
      },
    });

    this.scanIntervalMs = configService.scanInterval * 1000 || BLOCKCHAIN.BLOCKS.DEFAULT_SCAN_INTERVAL_MS;
    this.monitoringEnabled = configService.enableBlockMonitoring !== false;
    this.mainnetPrimaryEndpoint =
      configService.getPrimaryRpcUrl(parseInt(BLOCKCHAIN.CHAIN_IDS.MAINNET)) || BLOCKCHAIN.RPC.DEFAULT_MAINNET_RPC;
    this.testnetPrimaryEndpoint =
      configService.getPrimaryRpcUrl(parseInt(BLOCKCHAIN.CHAIN_IDS.TESTNET)) || BLOCKCHAIN.RPC.DEFAULT_TESTNET_RPC;

    // Initialize RPC clients with retry functionality
    this.mainnetClient = new RpcRetryClient(this.mainnetPrimaryEndpoint, {
      maxRetries: PERFORMANCE.RPC_CLIENT.MAX_RETRY_ATTEMPTS,
      retryDelayMs: PERFORMANCE.RPC_CLIENT.RETRY_DELAY_MS,
      timeoutMs: PERFORMANCE.RPC_CLIENT.DEFAULT_TIMEOUT_MS,
    });

    this.testnetClient = new RpcRetryClient(this.testnetPrimaryEndpoint, {
      maxRetries: PERFORMANCE.RPC_CLIENT.MAX_RETRY_ATTEMPTS,
      retryDelayMs: PERFORMANCE.RPC_CLIENT.RETRY_DELAY_MS,
      timeoutMs: PERFORMANCE.RPC_CLIENT.DEFAULT_TIMEOUT_MS,
    });

    // Load additional endpoints
    const mainnetEndpoints = configService
      .getRpcEndpoints()
      .filter(endpoint => endpoint.chainId === parseInt(BLOCKCHAIN.CHAIN_IDS.MAINNET) && endpoint.type === 'rpc')
      .map(endpoint => endpoint.url);

    if (mainnetEndpoints.length > 0) {
      this.mainnetEndpoints = mainnetEndpoints;
      this.mainnetClient.setFallbackUrls(this.mainnetEndpoints);
    }

    const testnetEndpoints = configService
      .getRpcEndpoints()
      .filter(endpoint => endpoint.chainId === parseInt(BLOCKCHAIN.CHAIN_IDS.TESTNET) && endpoint.type === 'rpc')
      .map(endpoint => endpoint.url);

    if (testnetEndpoints.length > 0) {
      this.testnetEndpoints = testnetEndpoints;
      this.testnetClient.setFallbackUrls(this.testnetEndpoints);
    }
  }

  /**
   * Initialize the service when the module is ready
   */
  async onModuleInit() {
    this.logger.log('Initializing block monitoring service...');

    try {
      // Load configuration from ConfigService
      this.scanIntervalMs = this.configService.scanInterval * 1000 || 15000;
      this.monitoringEnabled = this.configService.enableBlockMonitoring === true;
      this.mainnetPrimaryEndpoint = this.configService.getPrimaryRpcUrl(MAINNET_CHAIN_ID);
      this.testnetPrimaryEndpoint = this.configService.getPrimaryRpcUrl(TESTNET_CHAIN_ID);

      this.logger.log(`Block monitoring service configured (enabled: ${this.monitoringEnabled})`);
      this.logger.log(`Mainnet primary endpoint: ${this.mainnetPrimaryEndpoint}`);
      this.logger.log(`Testnet primary endpoint: ${this.testnetPrimaryEndpoint}`);
      this.logger.log(`Block scan interval: ${this.scanIntervalMs}ms`);

      // Initialize RPC clients with more robust error handling
      await this.initializeRpcClients();

      // Start monitoring if enabled
      if (this.monitoringEnabled) {
        this.logger.log('Starting block monitoring with a delayed start...');
        setTimeout(() => this.startMonitoring(), 5000); // 5-second delay to ensure services are ready
      } else {
        this.logger.log('Block monitoring is disabled in configuration');
      }
    } catch (error) {
      this.logger.error(`Failed to initialize block monitoring service: ${error.message}`);
      // Still try to start monitoring after a longer delay if it's enabled
      if (this.monitoringEnabled) {
        this.logger.log('Attempting to start monitoring despite initialization error...');
        setTimeout(() => this.startMonitoring(), 10000); // 10-second delay
      }
    }
  }

  /**
   * Initialize RPC clients with robust error handling
   */
  private async initializeRpcClients() {
    try {
      this.logger.log('Initializing RPC clients for block monitoring...');

      // Initialize mainnet client with multiple retries
      this.mainnetClient = new RpcRetryClient(this.mainnetPrimaryEndpoint, {
        maxRetries: 5,
        retryDelayMs: 1000,
        timeoutMs: 10000,
      });

      // Initialize testnet client with multiple retries
      this.testnetClient = new RpcRetryClient(this.testnetPrimaryEndpoint, {
        maxRetries: 5,
        retryDelayMs: 1000,
        timeoutMs: 10000,
      });

      // Test connections to ensure they're working
      const mainnetTest = this.mainnetClient.call('eth_chainId').catch(err => {
        this.logger.error(`Failed to connect to mainnet: ${err.message}`);
        return null;
      });

      const testnetTest = this.testnetClient.call('eth_chainId').catch(err => {
        this.logger.error(`Failed to connect to testnet: ${err.message}`);
        return null;
      });

      const [mainnetChainId, testnetChainId] = await Promise.all([mainnetTest, testnetTest]);

      this.logger.log(`RPC clients initialized - Mainnet: ${!!mainnetChainId}, Testnet: ${!!testnetChainId}`);
    } catch (error) {
      this.logger.error(`Error initializing RPC clients: ${error.message}`);
      throw error;
    }
  }

  /**
   * Start monitoring
   */
  startMonitoring() {
    if (!this.monitoringEnabled) {
      this.monitoringEnabled = true;
      this.logger.log('Starting block monitoring');
    }

    // Set initial scan interval with a slight delay to ensure blockchain service is initialized
    setTimeout(() => this.monitorBlocks(), 3000);
  }

  /**
   * Stop monitoring
   */
  stopMonitoring() {
    this.monitoringEnabled = false;
    this.logger.log('Stopping block monitoring');
  }

  /**
   * Main monitoring loop
   */
  private async monitorBlocks() {
    if (!this.monitoringEnabled) return;

    try {
      // Check mainnet
      await this.checkChain(BLOCKCHAIN.CHAIN_IDS.MAINNET);

      // Check testnet
      await this.checkChain(BLOCKCHAIN.CHAIN_IDS.TESTNET);
    } catch (error) {
      this.logger.error(`Error in block monitoring loop: ${error.message}`);
    } finally {
      // Schedule next scan
      setTimeout(() => this.monitorBlocks(), this.scanIntervalMs);
    }
  }

  /**
   * Check a chain for new blocks
   */
  private async checkChain(chainId: string) {
    try {
      const client = chainId === BLOCKCHAIN.CHAIN_IDS.MAINNET ? this.mainnetClient : this.testnetClient;

      if (!client) {
        this.logger.error(`No RPC client available for chain ${chainId}`);
        return;
      }

      // Get latest block
      const blockNumber = await client.call<string>(BLOCKCHAIN.RPC.METHODS.GET_BLOCK_NUMBER);

      if (!blockNumber) {
        this.logger.error(`Received null or empty block number from RPC for chain ${chainId}`);
        return;
      }

      const latestBlock = parseInt(blockNumber, 16);

      if (isNaN(latestBlock)) {
        this.logger.error(`Invalid block number format: ${blockNumber}`);
        return;
      }

      // Store the latest block number by chain
      if (chainId === BLOCKCHAIN.CHAIN_IDS.MAINNET) {
        this.mainnetLatestBlock = latestBlock;
      } else {
        this.testnetLatestBlock = latestBlock;
      }

      // Calculate time since last block
      const now = Date.now();
      if (this.lastBlockTimes[chainId]) {
        const blockTime = (now - this.lastBlockTimes[chainId]) / 1000;

        // Only record reasonable block times (ignore initial value or long delays)
        if (blockTime > 0 && blockTime < 300) {
          // Map chain ID to the correct network key
          const networkKey = chainId === BLOCKCHAIN.CHAIN_IDS.MAINNET ? NETWORK_MAINNET : NETWORK_TESTNET;

          // Now use the network key to access recentBlockTimes
          this.recentBlockTimes[networkKey].addDataPoint(blockTime);
          this.metricsService.setBlockTime(blockTime, parseInt(chainId));

          // Check for slow blocks
          this.checkBlockTime(blockTime, chainId);
        }
      }

      // Update last block time
      this.lastBlockTimes[chainId] = now;

      // Queue the block for processing
      this.enqueueBlock(chainId, latestBlock);

      // Set block height in metrics
      this.metricsService.setBlockHeight(
        latestBlock,
        chainId === BLOCKCHAIN.CHAIN_IDS.MAINNET ? this.mainnetPrimaryEndpoint : this.testnetPrimaryEndpoint,
        chainId,
      );

      // Check missing blocks
      await this.checkMissingBlocks(chainId, latestBlock);
    } catch (error) {
      this.logger.error(`Error checking chain ${chainId}: ${error.message}`);

      // Record RPC endpoint as down
      this.metricsService.setRpcStatus(
        chainId === BLOCKCHAIN.CHAIN_IDS.MAINNET ? this.mainnetPrimaryEndpoint : this.testnetPrimaryEndpoint,
        false,
        parseInt(chainId),
      );

      // Create alert
      this.alertsService.error(
        ALERTS.TYPES.RPC_ENDPOINT_DOWN,
        'rpc',
        `Primary RPC endpoint for chain ${chainId} is not responding: ${error.message}`,
      );
    }
  }

  /**
   * Check for missing blocks in a range
   */
  private async checkMissingBlocks(chainId: string, latestBlock: number) {
    // Skip for very low block numbers
    if (latestBlock < BLOCKCHAIN.BLOCKS.MISSING_BLOCKS_RANGE) return;

    try {
      // Only check a subset of blocks in each iteration to prevent too many
      // concurrent requests that might lead to "number of null" errors
      const startBlock = latestBlock - BLOCKCHAIN.BLOCKS.MISSING_BLOCKS_RANGE;

      // Only process a subset of the blocks at a time
      // This helps reduce load on the RPC node and prevents overwhelming the queue
      const blockCheckInterval = Math.max(1, Math.floor(BLOCKCHAIN.BLOCKS.MISSING_BLOCKS_RANGE / 10));

      for (let i = startBlock; i <= latestBlock; i += blockCheckInterval) {
        this.logger.debug(`Checking for missing block #${i} on chain ${chainId}`);

        try {
          // Use lower priority for missing block checks
          this.enqueueBlock(chainId, i, Priority.LOW);
        } catch (err) {
          // Log but continue with other blocks
          this.logger.warn(`Failed to enqueue block #${i} for chain ${chainId}: ${err.message}`);
        }
      }
    } catch (error) {
      this.logger.error(`Error checking missing blocks for chain ${chainId}: ${error.message}`);
    }
  }

  /**
   * Check for slow block times - only critical alerts
   */
  private checkBlockTime(blockTime: number, chainId: string) {
    const chainName = chainId === BLOCKCHAIN.CHAIN_IDS.MAINNET ? 'Mainnet' : 'Testnet';

    if (blockTime > BLOCKCHAIN.BLOCKS.BLOCK_TIME_ERROR_THRESHOLD) {
      this.alertsService.error(
        ALERTS.TYPES.HIGH_BLOCK_TIME,
        'blocks',
        `${chainName} block time is very high: ${blockTime.toFixed(1)} seconds`,
      );
    }
  }

  /**
   * Enqueue a block for processing
   */
  private enqueueBlock(chainId: string, blockNumber: number, priority: Priority = Priority.NORMAL) {
    // Validate block number before enqueueing
    if (blockNumber === undefined || blockNumber === null || isNaN(blockNumber)) {
      this.logger.error(`Attempted to enqueue invalid block number: ${blockNumber} for chain ${chainId}`);
      return;
    }

    const job: BlockProcessingJob = {
      block: null, // Will be fetched when processing
      chainId: parseInt(chainId, 10), // Convert to number as required by the interface
      blockNumber,
      endpoint: chainId === BLOCKCHAIN.CHAIN_IDS.MAINNET ? this.mainnetPrimaryEndpoint : this.testnetPrimaryEndpoint,
      timestamp: Date.now(),
      priority,
    };

    this.logger.debug(`Enqueueing block #${blockNumber} for chain ${chainId} with priority ${priority}`);
    this.blockProcessingQueue.enqueue(job, priority);
  }

  /**
   * Process a block from the queue
   */
  private async processBlockJob(job: BlockProcessingJob): Promise<void> {
    // Fetch the block using the job's chain ID and block number
    try {
      // Add a delay on first run to allow providers to initialize
      if (!this.initialBlockProcessed) {
        this.logger.debug(`First block processing - adding short delay to ensure providers are ready`);
        await new Promise(resolve => setTimeout(resolve, 2000));
        this.initialBlockProcessed = true;
      }

      const block = await this.blockchainService.getBlockByNumberForChain(job.blockNumber, job.chainId);

      // Enhanced safety check to ensure the block is valid and has all required properties
      if (!block) {
        this.logger.error(`Null block received for block #${job.blockNumber} on chain ${job.chainId}`);
        throw new Error(`Null block received for block #${job.blockNumber} on chain ${job.chainId}`);
      }

      if (block.number === undefined || block.number === null) {
        this.logger.error(`Invalid block received for block #${job.blockNumber}: missing number property`);
        throw new Error(`Invalid block received for block #${job.blockNumber}: missing number property`);
      }

      // Log success for debugging
      this.logger.debug(`Successfully fetched block #${block.number} on chain ${job.chainId}`);

      return this.processBlock(block, job.chainId.toString());
    } catch (error) {
      this.logger.error(`Failed to fetch block for processing: ${error.message}`);
      throw error; // Let the EnhancedQueue handle retries
    }
  }

  /**
   * Process a block from either Mainnet or Testnet
   */
  async processBlock(block: BlockInfo, chainId: string): Promise<void> {
    try {
      // Additional safety check at the start of processing
      if (!block || block.number === undefined || block.number === null) {
        throw new Error(`Invalid block data received for chain ${chainId}: missing or invalid block number`);
      }

      this.logger.debug(`Processing block #${block.number} (chainId: ${chainId})`);

      const parsedChainId = parseInt(chainId, 10);
      const chainName = CHAIN_ID_TO_NAME[parsedChainId] || 'Unknown';

      let confirmedTxCount = 0;
      let failedTxCount = 0;

      // Process transactions in batches for better performance
      if (block.transactions && block.transactions.length > 0) {
        try {
          const batchSize = 20; // Process 20 transactions at a time

          for (let i = 0; i < block.transactions.length; i += batchSize) {
            const batch = block.transactions.slice(i, i + batchSize);
            const txPromises = batch.map(async (txIdentifier: string | { hash: string }) => {
              try {
                // Safely access transaction hash depending on type
                const transactionHash =
                  typeof txIdentifier === 'string' ? txIdentifier : (txIdentifier as { hash: string }).hash;

                const txResult = await this.blockchainService.getTransaction(transactionHash);
                if (txResult) {
                  if (txResult.status === TransactionStatus.CONFIRMED) {
                    confirmedTxCount++;
                  } else if (txResult.status === TransactionStatus.FAILED) {
                    failedTxCount++;
                  }
                }
                return txResult;
              } catch (txError) {
                // Safe error logging with explicit typing
                const txId = typeof txIdentifier === 'string' ? txIdentifier : (txIdentifier as { hash: string }).hash;

                this.logger.error(`Error processing chain ${chainId} transaction ${txId}: ${txError.message}`);
                return null;
              }
            });

            await Promise.all(txPromises);
          }
        } catch (error) {
          this.logger.error(
            `Error processing chain ${chainId} transactions for block #${block.number}: ${error.message}`,
          );
          confirmedTxCount = block.transactions.length; // Assume confirmed if we can't verify
        }
      }

      this.metricsService.setTransactionsPerBlock(
        block.number,
        block.transactions.length,
        block.transactions.length - failedTxCount,
        failedTxCount,
        chainId,
      );

      // Get the appropriate network key and update the TimeWindowData structures
      const networkKey =
        CHAIN_ID_TO_NETWORK[parsedChainId] || (parsedChainId === MAINNET_CHAIN_ID ? NETWORK_MAINNET : NETWORK_TESTNET);

      // Track transaction metrics using TimeWindowData
      this.transactionCounts[networkKey].addDataPoint(block.transactions.length);
      this.failedTransactions[networkKey].addDataPoint(failedTxCount);

      // Get transaction metrics summary
      const totalTxs = this.transactionCounts[networkKey].getSum();
      const totalFailedTxs = this.failedTransactions[networkKey].getSum();
      const minutes = TRANSACTION_HISTORY_WINDOW_MS / (60 * 1000);

      // Log transaction stats
      this.logger.debug(
        `${networkKey} transactions in last ${minutes} min: ${totalTxs} total, ${totalFailedTxs} failed (${
          totalTxs > 0 ? ((totalFailedTxs / totalTxs) * 100).toFixed(2) : 0
        }% failure rate)`,
      );

      // Set metrics
      this.metricsService.setTransactionsPerMinute(
        totalTxs / minutes,
        parseInt(networkKey === NETWORK_MAINNET ? MAINNET_CHAIN_ID.toString() : TESTNET_CHAIN_ID.toString()),
      );

      this.logger.debug(
        `Block #${block.number} processed: ${block.transactions.length} txs, ${confirmedTxCount} confirmed, ${failedTxCount} failed`,
      );

      return Promise.resolve(); // Explicitly return for Enhanced Queue
    } catch (error) {
      this.logger.error(`Error in processBlock: ${error.message}`);
      throw error; // Rethrow for Enhanced Queue retry mechanism
    }
  }

  isBlockMonitoringEnabled(): boolean {
    return this.configService.enableBlockMonitoring === true;
  }

  /**
   * Get block monitoring status information
   */
  getBlockMonitoringInfo(): BlockMonitoringInfo {
    const rpcStatuses = this.rpcMonitorService.getAllRpcStatuses();

    // Group endpoints by chain
    const mainnetEndpoints = rpcStatuses.filter(e => e.chainId === MAINNET_CHAIN_ID).map(e => e.url);

    const testnetEndpoints = rpcStatuses.filter(e => e.chainId === TESTNET_CHAIN_ID).map(e => e.url);

    // Create RPC status maps
    const mainnetStatusMap = rpcStatuses
      .filter(e => e.chainId === MAINNET_CHAIN_ID)
      .reduce(
        (acc, endpoint) => {
          acc[endpoint.url] = endpoint.status === 'active';
          return acc;
        },
        {} as Record<string, boolean>,
      );

    const testnetStatusMap = rpcStatuses
      .filter(e => e.chainId === TESTNET_CHAIN_ID)
      .reduce(
        (acc, endpoint) => {
          acc[endpoint.url] = endpoint.status === 'active';
          return acc;
        },
        {} as Record<string, boolean>,
      );

    // Queue stats
    const queueSize = this.blockProcessingQueue.size();

    // Get block time statistics
    const blockTimeStats = {
      mainnet: {
        count: this.recentBlockTimes[NETWORK_MAINNET].count(),
        average: this.recentBlockTimes[NETWORK_MAINNET].getAverage() || 0,
        min: this.recentBlockTimes[NETWORK_MAINNET].getMin(),
        max: this.recentBlockTimes[NETWORK_MAINNET].getMax(),
        latest: this.recentBlockTimes[NETWORK_MAINNET].getLatest()?.value,
      },
      testnet: {
        count: this.recentBlockTimes[NETWORK_TESTNET].count(),
        average: this.recentBlockTimes[NETWORK_TESTNET].getAverage() || 0,
        min: this.recentBlockTimes[NETWORK_TESTNET].getMin(),
        max: this.recentBlockTimes[NETWORK_TESTNET].getMax(),
        latest: this.recentBlockTimes[NETWORK_TESTNET].getLatest()?.value,
      },
    };

    return {
      enabled: this.isBlockMonitoringEnabled(),
      primaryEndpoint: {
        mainnet: this.mainnetPrimaryEndpoint,
        testnet: this.testnetPrimaryEndpoint,
      },
      blockTimeThreshold: {
        error: BLOCKCHAIN.BLOCKS.BLOCK_TIME_ERROR_THRESHOLD,
      },
      scanInterval: this.scanIntervalMs,
      monitoredEndpoints: {
        mainnet: mainnetEndpoints,
        testnet: testnetEndpoints,
      },
      rpcStatus: {
        mainnet: mainnetStatusMap,
        testnet: testnetStatusMap,
      },
      queueStats: {
        size: queueSize,
        processing: 0, // We'll need to add a method to EnhancedQueue to track this
        completed: 0, // We'll need to add a method to EnhancedQueue to track this
      },
      blockTimeStats,
    };
  }
}
