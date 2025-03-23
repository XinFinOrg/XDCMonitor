import { BlockchainService } from '@blockchain/blockchain.service';
import { ALERTS, BLOCKCHAIN, PERFORMANCE } from '@common/constants/config';
import { MAINNET_CHAIN_ID, TESTNET_CHAIN_ID } from '@common/constants/endpoints';
import { EnhancedQueue, Priority } from '@common/utils/enhanced-queue';
import { RpcRetryClient } from '@common/utils/rpc-retry-client';
import { TimeWindowData } from '@common/utils/time-window-data';
import { ConfigService } from '@config/config.service';
import { MetricsService } from '@metrics/metrics.service';
import { AlertsService } from '@monitoring/alerts.service';
import { RpcMonitorService } from '@monitoring/rpc.monitor';
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { BlockInfo, BlockMonitoringInfo, BlockProcessingJob } from '@types';
import {
  CHAIN_ID_TO_NETWORK,
  NETWORK_MAINNET,
  NETWORK_TESTNET,
  RECENT_BLOCKS_SAMPLE_SIZE,
  TRANSACTION_HISTORY_WINDOW_MS,
} from '@common/constants/block-monitoring';

/**
 * Service for monitoring blocks across XDC networks
 */
@Injectable()
export class BlocksMonitorService implements OnModuleInit {
  // Logging
  private readonly logger = new Logger(BlocksMonitorService.name);

  // Configuration
  private monitoringEnabled = false;
  private scanIntervalMs: number;
  private settings = {
    blockMonitoring: {
      blockHeightVarianceCheckIntervalMs: 60000, // Default to 1 minute
    },
  };

  // Network endpoints
  private mainnetPrimaryEndpoint: string;
  private testnetPrimaryEndpoint: string;
  private mainnetEndpoints: string[] = [];
  private testnetEndpoints: string[] = [];

  // RPC clients
  private mainnetClient: RpcRetryClient;
  private testnetClient: RpcRetryClient;

  // Metrics data
  private recentBlockTimes: Record<string, TimeWindowData>;
  private transactionCounts: Record<string, TimeWindowData>;
  private failedTransactions: Record<string, TimeWindowData>;
  private _networkBlocks: Record<string, Record<string, number>> = {};
  private lastVarianceCheckTime = 0;

  // Processing
  private blockProcessingQueue: EnhancedQueue<BlockProcessingJob>;
  private _monitoringTimeout: NodeJS.Timeout;
  private initialBlockProcessed = false;

  constructor(
    private readonly blockchainService: BlockchainService,
    private readonly configService: ConfigService,
    private readonly rpcMonitorService: RpcMonitorService,
    private readonly metricsService: MetricsService,
    private readonly alertsService: AlertsService,
  ) {
    // Initialize time window data for metrics
    this.recentBlockTimes = this.createNetworkTimeWindows(24 * 60 * 60 * 1000); // 24 hour window
    this.transactionCounts = this.createNetworkTimeWindows(TRANSACTION_HISTORY_WINDOW_MS);
    this.failedTransactions = this.createNetworkTimeWindows(TRANSACTION_HISTORY_WINDOW_MS);

    // Load configuration
    this.initializeConfiguration();

    // Initialize the processing queue
    this.initializeProcessingQueue();

    // Initialize RPC clients
    this.initializeRpcClients();
  }

  /**
   * Initialize the service when the module is ready
   */
  async onModuleInit() {
    this.logger.log('Initializing block monitoring service...');

    try {
      // Refresh configuration (may have been updated after constructor)
      this.scanIntervalMs = this.configService.scanInterval * 1000 || 15000;
      this.monitoringEnabled = this.configService.enableBlockMonitoring;
      this.mainnetPrimaryEndpoint = this.configService.getPrimaryRpcUrl(MAINNET_CHAIN_ID);
      this.testnetPrimaryEndpoint = this.configService.getPrimaryRpcUrl(TESTNET_CHAIN_ID);

      // Log configuration
      this.logConfiguration();

      // Re-initialize RPC clients with connection testing
      await this.initializeAndTestRpcClients();

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
   * Log the current configuration
   */
  private logConfiguration(): void {
    this.logger.log(`Block monitoring service configured (enabled: ${this.monitoringEnabled})`);
    this.logger.log(`Mainnet primary endpoint: ${this.mainnetPrimaryEndpoint}`);
    this.logger.log(`Testnet primary endpoint: ${this.testnetPrimaryEndpoint}`);
    this.logger.log(`Block scan interval: ${this.scanIntervalMs}ms`);
  }

  /**
   * Initialize configuration from service
   */
  private initializeConfiguration(): void {
    this.scanIntervalMs = this.configService.scanInterval * 1000 || BLOCKCHAIN.BLOCKS.DEFAULT_SCAN_INTERVAL_MS;
    this.monitoringEnabled = this.configService.enableBlockMonitoring;

    // Set primary endpoints
    this.mainnetPrimaryEndpoint =
      this.configService.getPrimaryRpcUrl(parseInt(BLOCKCHAIN.CHAIN_IDS.MAINNET)) || BLOCKCHAIN.RPC.DEFAULT_MAINNET_RPC;

    this.testnetPrimaryEndpoint =
      this.configService.getPrimaryRpcUrl(parseInt(BLOCKCHAIN.CHAIN_IDS.TESTNET)) || BLOCKCHAIN.RPC.DEFAULT_TESTNET_RPC;

    // Load additional endpoints
    this.loadAdditionalEndpoints();
  }

  /**
   * Load additional RPC endpoints from configuration
   */
  private loadAdditionalEndpoints(): void {
    // Load mainnet endpoints
    const mainnetEndpoints = this.configService
      .getRpcEndpoints()
      .filter(endpoint => endpoint.chainId === parseInt(BLOCKCHAIN.CHAIN_IDS.MAINNET) && endpoint.type === 'rpc')
      .map(endpoint => endpoint.url);

    if (mainnetEndpoints.length > 0) {
      this.mainnetEndpoints = mainnetEndpoints;
    }

    // Load testnet endpoints
    const testnetEndpoints = this.configService
      .getRpcEndpoints()
      .filter(endpoint => endpoint.chainId === parseInt(BLOCKCHAIN.CHAIN_IDS.TESTNET) && endpoint.type === 'rpc')
      .map(endpoint => endpoint.url);

    if (testnetEndpoints.length > 0) {
      this.testnetEndpoints = testnetEndpoints;
    }
  }

  /**
   * Initialize the block processing queue
   */
  private initializeProcessingQueue(): void {
    this.blockProcessingQueue = new EnhancedQueue<BlockProcessingJob>(this.processBlockJob.bind(this), {
      maxConcurrent: 3,
      maxRetries: 3,
      retryDelayMs: 2000,
      processingTimeoutMs: 15000,
      getItemId: this.getJobId.bind(this),
      onSuccess: this.onJobSuccess.bind(this),
      onError: this.onJobError.bind(this),
      onMaxRetries: this.onJobMaxRetries.bind(this),
    });
  }

  /**
   * Generate ID for queue job
   */
  private getJobId(job: BlockProcessingJob): string {
    if (job.block?.number !== undefined) {
      return `${job.chainId}-${job.block.number}`;
    }
    if (job.blockNumber !== undefined) {
      return `${job.chainId}-${job.blockNumber}`;
    }
    return `${job.chainId}-${job.timestamp || Date.now()}`;
  }

  /**
   * Handle successful job processing
   */
  private onJobSuccess(job: BlockProcessingJob): void {
    const blockNum = job.block?.number || job.blockNumber;
    this.logger.debug(`Successfully processed block #${blockNum} on chain ${job.chainId}`);
  }

  /**
   * Handle job processing error
   */
  private onJobError(job: BlockProcessingJob, error: Error, attempts: number): void {
    const blockNum = job.block?.number || job.blockNumber;
    this.logger.warn(
      `Error processing block #${blockNum} on chain ${job.chainId} (attempt ${attempts}): ${error.message}`,
    );
  }

  /**
   * Handle max retries reached for job
   */
  private onJobMaxRetries(job: BlockProcessingJob, error: Error, attempts: number): void {
    const blockNum = job.block?.number || job.blockNumber;
    this.logger.error(
      `Failed to process block #${blockNum} on chain ${job.chainId} after ${attempts} attempts: ${error.message}`,
    );
    this.alertsService.error(`Failed to process block #${blockNum}`, 'blockchain', error.message);
  }

  /**
   * Initialize RPC clients
   */
  private initializeRpcClients(): void {
    // Create clients with retry functionality
    this.mainnetClient = this.createRpcClient(this.mainnetPrimaryEndpoint);
    this.testnetClient = this.createRpcClient(this.testnetPrimaryEndpoint);

    // Set fallback URLs if available
    if (this.mainnetEndpoints.length > 0) {
      this.mainnetClient.setFallbackUrls(this.mainnetEndpoints);
    }

    if (this.testnetEndpoints.length > 0) {
      this.testnetClient.setFallbackUrls(this.testnetEndpoints);
    }
  }

  /**
   * Initialize and test RPC clients
   */
  private async initializeAndTestRpcClients() {
    try {
      this.logger.log('Initializing RPC clients for block monitoring...');

      // Initialize clients with multiple retries
      this.mainnetClient = this.createRpcClient(this.mainnetPrimaryEndpoint, {
        maxRetries: 5,
        retryDelayMs: 1000,
        timeoutMs: 10000,
      });

      this.testnetClient = this.createRpcClient(this.testnetPrimaryEndpoint, {
        maxRetries: 5,
        retryDelayMs: 1000,
        timeoutMs: 10000,
      });

      // Test connections to ensure they're working
      const [mainnetChainId, testnetChainId] = await Promise.all([
        this.mainnetClient.call('eth_chainId').catch(err => {
          this.logger.error(`Failed to connect to mainnet: ${err.message}`);
          return null;
        }),
        this.testnetClient.call('eth_chainId').catch(err => {
          this.logger.error(`Failed to connect to testnet: ${err.message}`);
          return null;
        }),
      ]);

      this.logger.log(`RPC clients initialized - Mainnet: ${!!mainnetChainId}, Testnet: ${!!testnetChainId}`);
    } catch (error) {
      this.logger.error(`Error initializing RPC clients: ${error.message}`);
      throw error;
    }
  }

  /**
   * Create an RPC client with standard retry configuration
   */
  private createRpcClient(
    endpoint: string,
    options: Partial<{
      maxRetries: number;
      retryDelayMs: number;
      timeoutMs: number;
    }> = {},
  ): RpcRetryClient {
    return new RpcRetryClient(endpoint, {
      maxRetries: options.maxRetries || PERFORMANCE.RPC_CLIENT.MAX_RETRY_ATTEMPTS,
      retryDelayMs: options.retryDelayMs || PERFORMANCE.RPC_CLIENT.RETRY_DELAY_MS,
      timeoutMs: options.timeoutMs || PERFORMANCE.RPC_CLIENT.DEFAULT_TIMEOUT_MS,
    });
  }

  /**
   * Start monitoring
   */
  public startMonitoring() {
    this.logger.log('Starting block monitoring');

    // Always ensure the flag is set to true when starting
    this.monitoringEnabled = true;

    // Clear any existing timeout to prevent duplicates
    if (this._monitoringTimeout) {
      clearTimeout(this._monitoringTimeout);
    }

    // Set initial scan with a slight delay to ensure blockchain service is initialized
    this.logger.log('Scheduling initial block scan in 3 seconds...');
    this._monitoringTimeout = setTimeout(() => {
      try {
        this.monitorBlocks();
      } catch (e) {
        this.logger.error(`Error starting block monitoring: ${e.message}`);

        // Try to restart after a delay
        this.logger.log('Attempting to restart monitoring after error...');
        setTimeout(() => this.startMonitoring(), 10000); // 10-second delay
      }
    }, 3000);
  }

  /**
   * Stop monitoring
   */
  public stopMonitoring() {
    this.logger.log('Stopping block monitoring');
    this.monitoringEnabled = false;

    // Clean up any pending timeouts
    if (this._monitoringTimeout) {
      clearTimeout(this._monitoringTimeout);
      this._monitoringTimeout = null;
    }
  }

  /**
   * Main monitoring loop
   */
  private async monitorBlocks() {
    this.logger.debug(`Monitor blocks called, enabled: ${this.monitoringEnabled}`);

    if (!this.monitoringEnabled) {
      this.logger.warn('Monitoring disabled but monitorBlocks called');
      return;
    }

    try {
      // Process chains
      await this.processAllChains();
    } catch (e) {
      this.logger.error(`Unexpected error in block processing: ${e.message}`);
    } finally {
      // Always schedule next scan, even if there was an error
      this.scheduleNextMonitoringCycle();
    }
  }

  /**
   * Process all chains in sequence
   */
  private async processAllChains(): Promise<boolean> {
    try {
      // Check mainnet
      this.logger.debug('Checking mainnet...');
      await this.checkChain(BLOCKCHAIN.CHAIN_IDS.MAINNET);

      // Check testnet
      this.logger.debug('Checking testnet...');
      await this.checkChain(BLOCKCHAIN.CHAIN_IDS.TESTNET);

      this.logger.debug('Chain checks completed successfully');
      return true;
    } catch (error) {
      this.logger.error(`Error in block monitoring loop: ${error.message}`);
      if (error.stack) {
        this.logger.error(`Stack trace: ${error.stack}`);
      }
      return false;
    }
  }

  /**
   * Schedule the next monitoring cycle
   */
  private scheduleNextMonitoringCycle(): void {
    this.logger.log(`Scheduling next block monitoring scan in ${this.scanIntervalMs}ms`);

    // Store the timeout ID to ensure it's not garbage collected
    this._monitoringTimeout = setTimeout(async () => {
      if (this.monitoringEnabled) {
        try {
          // OPTIMIZATION: Use a more direct approach without extra layers
          // Process chains directly without additional async function calls
          try {
            // Check mainnet
            this.logger.debug('Checking mainnet...');
            await this.checkChain(BLOCKCHAIN.CHAIN_IDS.MAINNET);

            // Check testnet
            this.logger.debug('Checking testnet...');
            await this.checkChain(BLOCKCHAIN.CHAIN_IDS.TESTNET);

            this.logger.debug('Chain checks completed successfully');
          } catch (chainError) {
            this.logger.error(`Error in block monitoring loop: ${chainError.message}`);
          }

          // Schedule next cycle
          this.scheduleNextMonitoringCycle();
        } catch (e) {
          this.logger.error(`Fatal error in monitoring loop: ${e.message}`);
          // Try to restart monitoring after a delay to avoid infinite error loops
          setTimeout(() => {
            if (this.monitoringEnabled) {
              this.logger.log('Attempting to restart monitoring after fatal error...');
              this.monitorBlocks();
            }
          }, this.scanIntervalMs);
        }
      }
    }, this.scanIntervalMs);
  }

  /**
   * Check a chain for new blocks
   */
  private async checkChain(chainId: string) {
    this.logger.debug(`checkChain starting for chain ${chainId}`);

    try {
      // Get necessary data for checking
      const { primaryEndpoint, client, allRpcEndpoints } = this.prepareChainCheck(chainId);

      if (!client) {
        this.logger.error(`No RPC client available for chain ${chainId}`);
        return;
      }

      // Object to track block heights across all endpoints
      const endpointBlockHeights: Record<string, number> = {};

      // Check primary endpoint first
      await this.checkPrimaryEndpoint(chainId, primaryEndpoint, client, endpointBlockHeights);

      // Check secondary endpoints in parallel
      await this.checkSecondaryEndpoints(chainId, primaryEndpoint, allRpcEndpoints, endpointBlockHeights);

      this.logger.debug(`All endpoint checks completed for chain ${chainId}`);
    } catch (error) {
      this.logger.error(`Error in checkChain for ${chainId}: ${error.message}`);
      if (error.stack) {
        this.logger.error(`Stack trace: ${error.stack}`);
      }
    }

    this.logger.debug(`checkChain finished for chain ${chainId}`);
  }

  /**
   * Prepare data needed for chain checking
   */
  private prepareChainCheck(chainId: string): {
    primaryEndpoint: string;
    client: RpcRetryClient;
    allRpcEndpoints: string[];
  } {
    // Get all RPC endpoints for this chain
    const allRpcEndpoints = this.rpcMonitorService
      .getAllRpcStatuses()
      .filter(endpoint => endpoint.chainId.toString() === chainId)
      .map(endpoint => endpoint.url);

    this.logger.debug(`Found ${allRpcEndpoints.length} RPC endpoints for chain ${chainId}`);

    // Set primary endpoint
    const primaryEndpoint =
      chainId === BLOCKCHAIN.CHAIN_IDS.MAINNET ? this.mainnetPrimaryEndpoint : this.testnetPrimaryEndpoint;

    // Use existing client for primary endpoint
    const client = chainId === BLOCKCHAIN.CHAIN_IDS.MAINNET ? this.mainnetClient : this.testnetClient;

    return { primaryEndpoint, client, allRpcEndpoints };
  }

  /**
   * Check primary endpoint for a chain
   */
  private async checkPrimaryEndpoint(
    chainId: string,
    primaryEndpoint: string,
    client: RpcRetryClient,
    endpointBlockHeights: Record<string, number>,
  ): Promise<void> {
    try {
      this.logger.debug(`Getting latest block from primary endpoint for chain ${chainId}`);
      const blockNumberHex = await client.call<string>(BLOCKCHAIN.RPC.METHODS.GET_BLOCK_NUMBER);

      if (!blockNumberHex) {
        this.logger.error(`Received null or empty block number from primary RPC for chain ${chainId}`);
        return;
      }

      const latestBlock = parseInt(blockNumberHex, 16);

      if (isNaN(latestBlock)) {
        this.logger.error(`Invalid block number format from primary RPC: ${blockNumberHex}`);
        return;
      }

      // Store primary endpoint block height
      endpointBlockHeights[primaryEndpoint] = latestBlock;

      // DIRECT UPDATE: Set block height in metrics immediately (no queue)
      this.metricsService.setBlockHeight(latestBlock, primaryEndpoint, chainId);

      // Process the latest block data for other metrics
      await this.processLatestBlockData(chainId, primaryEndpoint, latestBlock);
    } catch (error) {
      this.handlePrimaryEndpointError(chainId, primaryEndpoint, error);
    }
  }

  /**
   * Process latest block data from primary endpoint
   */
  private async processLatestBlockData(chainId: string, primaryEndpoint: string, latestBlock: number): Promise<void> {
    // Get network key for this chain
    const networkKey = this.getNetworkKey(chainId);

    // Fetch the latest block for its timestamp
    try {
      const chainIdNum = parseInt(chainId, 10);
      const latestBlockData = await this.blockchainService.getBlockByNumberForChain(latestBlock, chainIdNum);

      // If we have the latest block, also fetch the previous block to calculate block time
      if (latestBlockData && latestBlockData.number > 0) {
        const previousBlockNumber = latestBlockData.number - 1;
        const previousBlockData = await this.blockchainService.getBlockByNumberForChain(
          previousBlockNumber,
          chainIdNum,
        );

        if (previousBlockData && previousBlockData.timestamp) {
          // Calculate block time as the difference between consecutive block timestamps
          const blockTimeSeconds = (latestBlockData.timestamp - previousBlockData.timestamp) / 1000;

          // Only record reasonable block times
          if (blockTimeSeconds > 0 && blockTimeSeconds < 300) {
            // Record block time metrics in one place only
            this.recentBlockTimes[networkKey].addDataPoint(blockTimeSeconds);
            this.metricsService.setBlockTime(blockTimeSeconds, chainIdNum);
            this.logger.debug(`Block time for chain ${chainId} block #${latestBlock}: ${blockTimeSeconds.toFixed(2)}s`);

            // Check for slow blocks
            this.checkBlockTime(blockTimeSeconds, chainId);
          } else {
            this.logger.debug(
              `Skipping abnormal block time: ${blockTimeSeconds}s between blocks ${previousBlockNumber} and ${latestBlock}`,
            );
          }
        }
      }

      // Queue the latest block for full processing (transactions, etc.)
      // but NOT for block height updates (already done directly)
      this.enqueueBlock(chainId, latestBlock);
    } catch (error) {
      this.logger.error(`Error fetching blocks for time calculation: ${error.message}`);
      // Still try to enqueue the block even if time calculation failed
      this.enqueueBlock(chainId, latestBlock);
    }

    // Check for missing blocks
    await this.checkMissingBlocks(chainId, latestBlock);
  }

  /**
   * Handle errors from primary endpoint check
   */
  private handlePrimaryEndpointError(chainId: string, primaryEndpoint: string, error: Error): void {
    this.logger.error(`Error checking primary endpoint ${primaryEndpoint}: ${error.message}`);

    // Record primary RPC endpoint as down
    this.metricsService.setRpcStatus(primaryEndpoint, false, parseInt(chainId));

    // Create alert for primary endpoint
    this.alertsService.error(
      ALERTS.TYPES.RPC_ENDPOINT_DOWN,
      'rpc',
      `Primary RPC endpoint for chain ${chainId} is not responding: ${error.message}`,
      parseInt(chainId),
    );
  }

  /**
   * Check secondary endpoints in parallel
   */
  private async checkSecondaryEndpoints(
    chainId: string,
    primaryEndpoint: string,
    allRpcEndpoints: string[],
    endpointBlockHeights: Record<string, number>,
  ): Promise<void> {
    // Query all other RPC endpoints in parallel
    this.logger.debug(`Checking ${allRpcEndpoints.length - 1} secondary endpoints for chain ${chainId}`);

    const endpointPromises = allRpcEndpoints
      .filter(endpoint => endpoint !== primaryEndpoint) // Skip primary endpoint as we already processed it
      .map(endpoint => this.checkSecondaryEndpoint(endpoint, chainId, endpointBlockHeights));

    await Promise.all(endpointPromises).catch(error => {
      this.logger.error(`Error waiting for endpoint promises: ${error.message}`);
    });
  }

  /**
   * Check a single secondary endpoint
   */
  private async checkSecondaryEndpoint(
    endpoint: string,
    chainId: string,
    endpointBlockHeights: Record<string, number>,
  ): Promise<void> {
    try {
      // Create temporary client for this endpoint
      const tempClient = new RpcRetryClient(endpoint, {
        maxRetries: 1,
        retryDelayMs: 500,
        timeoutMs: 3000, // Short timeout to avoid blocking
      });

      // Get this endpoint's block height
      const blockNumberHex = await tempClient.call<string>(BLOCKCHAIN.RPC.METHODS.GET_BLOCK_NUMBER);

      if (blockNumberHex) {
        const blockNumber = parseInt(blockNumberHex, 16);
        if (!isNaN(blockNumber)) {
          // Save to our tracking object
          endpointBlockHeights[endpoint] = blockNumber;

          // DIRECT UPDATE: Set block height metrics immediately for this endpoint
          this.metricsService.setBlockHeight(blockNumber, endpoint, chainId);
          this.metricsService.setRpcStatus(endpoint, true, parseInt(chainId));
        }
      }
    } catch (error) {
      this.logger.warn(`Failed to get block height from ${endpoint}: ${error.message}`);
      this.metricsService.setRpcStatus(endpoint, false, parseInt(chainId));
    }
  }

  /**
   * Check for missing blocks in a range
   */
  private async checkMissingBlocks(chainId: string, latestBlock: number) {
    // Skip for very low block numbers
    if (latestBlock < BLOCKCHAIN.BLOCKS.MISSING_BLOCKS_RANGE) {
      return;
    }

    try {
      // Only check a subset of blocks in each iteration
      const startBlock = latestBlock - BLOCKCHAIN.BLOCKS.MISSING_BLOCKS_RANGE;

      // Use larger interval to significantly reduce load (5% of range)
      const interval = Math.max(1, Math.floor(BLOCKCHAIN.BLOCKS.MISSING_BLOCKS_RANGE / 20));

      // Limit how many blocks we enqueue at once
      const maxBlocksToCheck = 5;
      let enqueuedCount = 0;

      for (let i = startBlock; i <= latestBlock && enqueuedCount < maxBlocksToCheck; i += interval) {
        try {
          // Use lowest priority for missing block checks
          this.enqueueBlock(chainId, i, { priority: Priority.LOW });
          enqueuedCount++;

          // Add a small delay between enqueues to spread out the load
          await new Promise(resolve => setTimeout(resolve, 50));
        } catch (err) {
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
  private checkBlockTime(blockTime: number, chainId: string | number) {
    const chainIdStr = typeof chainId === 'number' ? chainId.toString() : chainId;
    const chainName = chainIdStr === BLOCKCHAIN.CHAIN_IDS.MAINNET ? 'Mainnet' : 'Testnet';

    if (blockTime > BLOCKCHAIN.BLOCKS.BLOCK_TIME_ERROR_THRESHOLD) {
      this.alertsService.error(
        ALERTS.TYPES.HIGH_BLOCK_TIME,
        'blocks',
        `${chainName} block time is very high: ${blockTime.toFixed(1)} seconds`,
        parseInt(chainIdStr),
      );
    }
  }

  /**
   * Enqueue a block for processing
   */
  private enqueueBlock(
    chainId: string,
    blockNumber: number,
    options: {
      priority?: Priority;
      endpoint?: string;
    } = {},
  ) {
    // Validate block number before enqueueing
    if (blockNumber === undefined || blockNumber === null || isNaN(blockNumber)) {
      this.logger.error(`Attempted to enqueue invalid block number: ${blockNumber} for chain ${chainId}`);
      return;
    }

    const priority = options.priority || Priority.NORMAL;
    const endpoint =
      options.endpoint ||
      (chainId === BLOCKCHAIN.CHAIN_IDS.MAINNET ? this.mainnetPrimaryEndpoint : this.testnetPrimaryEndpoint);

    const job: BlockProcessingJob = {
      block: null, // Will be fetched when processing
      chainId: parseInt(chainId, 10),
      blockNumber,
      endpoint,
      timestamp: Date.now(),
      priority,
    };

    this.blockProcessingQueue.enqueue(job, priority);
  }

  /**
   * Process a block from the queue
   */
  private async processBlockJob(job: BlockProcessingJob): Promise<void> {
    try {
      this.logger.debug(
        `Processing block job for chain ${job.chainId}, block #${job.blockNumber || job.block?.number || 'unknown'}`,
      );

      // Add a delay on first run to allow providers to initialize
      if (!this.initialBlockProcessed) {
        await new Promise(resolve => setTimeout(resolve, 2000));
        this.initialBlockProcessed = true;
      }

      // Fetch the block
      const { block, responseTime, usedEndpoint } = await this.fetchBlockForJob(job);

      // Validate block
      if (!block || block.number === undefined) {
        throw new Error(`Invalid block received for block #${job.blockNumber} on chain ${job.chainId}`);
      }

      // Record metrics
      this.metricsService.setBlockResponseTime(usedEndpoint, responseTime, job.chainId);
      this.metricsService.setRpcStatus(usedEndpoint, true, job.chainId);

      // Process the block
      return this.processBlock(block, job.chainId.toString(), Date.now(), responseTime, usedEndpoint);
    } catch (error) {
      // Enhanced error logging with more context
      const endpoint = job.endpoint || this.getPrimaryEndpoint(job.chainId);
      this.logger.error(
        `Failed to fetch block #${job.blockNumber} for chain ${job.chainId} from endpoint ${endpoint}: ${error.message}`,
      );

      // Mark endpoint as having issues
      this.metricsService.setRpcStatus(endpoint, false, job.chainId);

      throw error; // Let the EnhancedQueue handle retries
    }
  }

  /**
   * Fetch a block for a processing job
   */
  private async fetchBlockForJob(job: BlockProcessingJob): Promise<{
    block: BlockInfo | null;
    responseTime: number;
    usedEndpoint: string;
  }> {
    let block: BlockInfo | null = null;
    let responseTime = 0;
    let usedEndpoint = job.endpoint || this.getPrimaryEndpoint(job.chainId);

    // Fetch block from specific endpoint or fall back to primary
    if (job.endpoint && job.endpoint !== this.getPrimaryEndpoint(job.chainId)) {
      // Try to fetch from specified endpoint
      const result = await this.fetchBlockFromEndpoint(job.endpoint, job.blockNumber, job.chainId);

      if (result.block) {
        // Successfully fetched from specified endpoint
        block = result.block;
        responseTime = result.responseTime;
      } else {
        // Fall back to primary endpoint
        usedEndpoint = this.getPrimaryEndpoint(job.chainId);
        const fallbackStartTime = Date.now();
        block = await this.blockchainService.getBlockByNumberForChain(job.blockNumber, job.chainId);
        responseTime = Date.now() - fallbackStartTime;
      }
    } else {
      // Use primary endpoint directly via blockchain service
      const primaryStartTime = Date.now();
      block = await this.blockchainService.getBlockByNumberForChain(job.blockNumber, job.chainId);
      responseTime = Date.now() - primaryStartTime;
    }

    return { block, responseTime, usedEndpoint };
  }

  /**
   * Fetch a block from a specific endpoint with error handling
   */
  private async fetchBlockFromEndpoint(
    endpoint: string,
    blockNumber: number,
    chainId: number,
  ): Promise<{ block: BlockInfo | null; responseTime: number; endpoint: string }> {
    const startTime = Date.now();

    try {
      // Create temporary client for this endpoint
      const tempClient = this.createRpcClient(endpoint, {
        maxRetries: 2,
        retryDelayMs: 1000,
        timeoutMs: 5000, // shorter timeout for secondary endpoints
      });

      // Use eth_getBlockByNumber RPC call directly
      const result = await tempClient.call('eth_getBlockByNumber', [
        `0x${blockNumber.toString(16)}`,
        true, // Include full transaction objects
      ]);

      const responseTime = Date.now() - startTime;

      if (!result) {
        throw new Error(`Null result when fetching block #${blockNumber} from ${endpoint}`);
      }

      // Convert the RPC result into our BlockInfo format
      const block = this.convertRpcResultToBlockInfo(result);

      return { block, responseTime, endpoint };
    } catch (error) {
      this.logger.warn(`Error fetching block #${blockNumber} from endpoint ${endpoint}: ${error.message}`);
      this.metricsService.setRpcStatus(endpoint, false, chainId);
      return { block: null, responseTime: Date.now() - startTime, endpoint };
    }
  }

  /**
   * Convert RPC result to BlockInfo format
   */
  private convertRpcResultToBlockInfo(result: any): BlockInfo {
    return {
      number: parseInt(result.number, 16),
      hash: result.hash,
      parentHash: result.parentHash,
      timestamp: parseInt(result.timestamp, 16) * 1000, // Convert to ms
      transactions: result.transactions || [],
      miner: result.miner,
      gasUsed: result.gasUsed ? BigInt(parseInt(result.gasUsed, 16)) : BigInt(0),
      gasLimit: result.gasLimit ? BigInt(parseInt(result.gasLimit, 16)) : BigInt(0),
    };
  }

  /**
   * Process a block from either Mainnet or Testnet
   */
  async processBlock(
    block: BlockInfo,
    chainId: string,
    timestamp = Date.now(),
    responseTime?: number,
    endpoint?: string,
  ): Promise<void> {
    try {
      // Additional safety check
      if (!block || block.number === undefined || block.number === null) {
        throw new Error(`Invalid block data received for chain ${chainId}: missing or invalid block number`);
      }

      const parsedChainId = parseInt(chainId, 10);
      const networkKey = this.getNetworkKey(parsedChainId);

      // Record metrics if endpoint is provided
      if (endpoint) {
        this.recordBlockMetrics(block, endpoint, chainId, responseTime, parsedChainId);
      }

      // Process block data
      await this.processBlockData(block, chainId, networkKey, parsedChainId);

      return Promise.resolve(); // Explicitly return for Enhanced Queue
    } catch (error) {
      this.logger.error(`Error in processBlock: ${error.message}`);
      throw error; // Rethrow for Enhanced Queue retry mechanism
    }
  }

  /**
   * Record metrics for a block
   */
  private recordBlockMetrics(
    block: BlockInfo,
    endpoint: string,
    chainId: string,
    responseTime: number | undefined,
    parsedChainId: number,
  ): void {
    // Update block height metric
    this.metricsService.setBlockHeight(block.number, endpoint, chainId);

    // Record response time
    if (responseTime) {
      this.metricsService.setBlockResponseTime(endpoint, responseTime, parsedChainId);
    }
  }

  /**
   * Process block data for metrics and monitoring
   */
  private async processBlockData(
    block: BlockInfo,
    chainId: string,
    networkKey: string,
    parsedChainId: number,
  ): Promise<void> {
    try {
      // Process block height variance
      this.processBlockHeightVariance(block, networkKey);

      // Process transactions
      const { confirmedCount, failedCount } = await this.processBlockTransactions(block, chainId);

      // Update transaction metrics
      this.updateTransactionMetrics(block, chainId, networkKey, parsedChainId, confirmedCount, failedCount);
    } catch (innerError) {
      // Catch errors from individual processing steps but continue
      this.logger.error(`Error in block processing step: ${innerError.message}`);
    }
  }

  /**
   * Update transaction metrics
   */
  private updateTransactionMetrics(
    block: BlockInfo,
    chainId: string,
    networkKey: string,
    parsedChainId: number,
    confirmedCount: number,
    failedCount: number,
  ): void {
    // Set transactions per block metrics
    this.metricsService.setTransactionsPerBlock(
      block.number,
      block.transactions.length,
      confirmedCount,
      failedCount,
      chainId,
    );

    // Track transaction metrics using TimeWindowData
    this.transactionCounts[networkKey].addDataPoint(block.transactions.length);
    if (failedCount > 0) {
      this.failedTransactions[networkKey].addDataPoint(failedCount);
    }

    // Calculate transactions per minute
    const totalTxs = this.transactionCounts[networkKey].getSum();
    const minutes = TRANSACTION_HISTORY_WINDOW_MS / (60 * 1000);
    this.metricsService.setTransactionsPerMinute(totalTxs / minutes, parsedChainId);
  }

  /**
   * Check if block monitoring is enabled
   */
  public isBlockMonitoringEnabled(): boolean {
    return this.configService.enableBlockMonitoring === true;
  }

  /**
   * Get block monitoring status information
   */
  getBlockMonitoringInfo(): BlockMonitoringInfo {
    try {
      // Get RPC statuses
      const rpcStatuses = this.getSafeRpcStatuses();

      // Group endpoints by chain
      const endpointData = this.groupEndpointsByChain(rpcStatuses);

      // Get queue size
      const queueSize = this.getSafeQueueSize();

      // Get block time statistics
      const blockTimeStats = this.getBlockTimeStats();

      // Initialize network monitoring data
      const monitoredEndpoints = this.initializeNetworkMonitoringData(endpointData);

      // Calculate block height variance
      const blockHeightVariance = this.calculateNetworkVariances(monitoredEndpoints);

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
        monitoredEndpoints,
        rpcStatus: {
          mainnet: endpointData.mainnetStatusMap,
          testnet: endpointData.testnetStatusMap,
        },
        blockHeightVariance,
        queueStats: {
          size: queueSize,
          processing: 0,
          completed: 0,
        },
        blockTimeStats,
      };
    } catch (error) {
      this.logger.error(`Critical error in getBlockMonitoringInfo: ${error.message}`);

      // Return a minimal valid object to prevent crashes
      return this.createFallbackMonitoringInfo();
    }
  }

  /**
   * Get RPC statuses with error handling
   */
  private getSafeRpcStatuses() {
    try {
      return this.rpcMonitorService.getAllRpcStatuses();
    } catch (rpcError) {
      this.logger.error(`Failed to get RPC statuses: ${rpcError.message}`);
      return [];
    }
  }

  /**
   * Group endpoints by chain
   */
  private groupEndpointsByChain(rpcStatuses: any[]) {
    // Extract endpoints for each chain
    const mainnetEndpoints = rpcStatuses.filter(e => e.chainId === MAINNET_CHAIN_ID).map(e => e.url);

    const testnetEndpoints = rpcStatuses.filter(e => e.chainId === TESTNET_CHAIN_ID).map(e => e.url);

    // Create status maps
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

    return {
      mainnetEndpoints,
      testnetEndpoints,
      mainnetStatusMap,
      testnetStatusMap,
    };
  }

  /**
   * Get queue size with error handling
   */
  private getSafeQueueSize(): number {
    try {
      return this.blockProcessingQueue.size();
    } catch (queueError) {
      this.logger.error(`Failed to get queue size: ${queueError.message}`);
      return 0;
    }
  }

  /**
   * Get block time statistics for each network
   */
  private getBlockTimeStats() {
    const getTimeWindowStats = (network: string) => {
      try {
        const timeWindow = this.recentBlockTimes[network];
        return {
          count: timeWindow.count(),
          average: timeWindow.getAverage() || 0,
          min: timeWindow.getMin(),
          max: timeWindow.getMax(),
          latest: timeWindow.getLatest()?.value,
        };
      } catch (error) {
        this.logger.error(`Failed to get block time stats for ${network}: ${error.message}`);
        return {
          count: 0,
          average: 0,
          min: undefined,
          max: undefined,
          latest: undefined,
        };
      }
    };

    return {
      mainnet: getTimeWindowStats(NETWORK_MAINNET),
      testnet: getTimeWindowStats(NETWORK_TESTNET),
    };
  }

  /**
   * Initialize network monitoring data
   */
  private initializeNetworkMonitoringData(endpointData: any) {
    return {
      mainnet: {
        endpoints: endpointData.mainnetEndpoints,
        rpcBlocks: {},
        lastBlockTimestamp: Date.now(),
        consecutiveHighVarianceCount: 0,
      },
      testnet: {
        endpoints: endpointData.testnetEndpoints,
        rpcBlocks: {},
        lastBlockTimestamp: Date.now(),
        consecutiveHighVarianceCount: 0,
      },
    };
  }

  /**
   * Calculate network variances
   */
  private calculateNetworkVariances(monitoredEndpoints: any) {
    let mainnetVariance = 0;
    let testnetVariance = 0;

    try {
      mainnetVariance = this.calculateBlockHeightVariance(NETWORK_MAINNET, monitoredEndpoints.mainnet);
    } catch (error) {
      this.logger.error(`Failed to calculate mainnet variance: ${error.message}`);
    }

    try {
      testnetVariance = this.calculateBlockHeightVariance(NETWORK_TESTNET, monitoredEndpoints.testnet);
    } catch (error) {
      this.logger.error(`Failed to calculate testnet variance: ${error.message}`);
    }

    return {
      mainnet: mainnetVariance,
      testnet: testnetVariance,
    };
  }

  /**
   * Create fallback monitoring info for error cases
   */
  private createFallbackMonitoringInfo(): BlockMonitoringInfo {
    return {
      enabled: this.isBlockMonitoringEnabled(),
      primaryEndpoint: {
        mainnet: this.mainnetPrimaryEndpoint || '',
        testnet: this.testnetPrimaryEndpoint || '',
      },
      blockTimeThreshold: {
        error: BLOCKCHAIN.BLOCKS.BLOCK_TIME_ERROR_THRESHOLD || 60,
      },
      scanInterval: this.scanIntervalMs || 15000,
      monitoredEndpoints: {
        mainnet: { endpoints: [] },
        testnet: { endpoints: [] },
      },
      rpcStatus: {
        mainnet: {},
        testnet: {},
      },
      blockHeightVariance: {
        mainnet: 0,
        testnet: 0,
      },
      queueStats: {
        size: 0,
        processing: 0,
        completed: 0,
      },
      blockTimeStats: {
        mainnet: { count: 0, average: 0 },
        testnet: { count: 0, average: 0 },
      },
    };
  }

  /**
   * Process transactions from a block with optimized batching and error handling
   */
  private async processBlockTransactions(
    block: BlockInfo,
    chainId: string,
  ): Promise<{ confirmedCount: number; failedCount: number }> {
    let confirmedCount = 0;
    let failedCount = 0;

    if (!block.transactions || block.transactions.length === 0) {
      return { confirmedCount, failedCount };
    }

    try {
      // Use smaller batch size for very large blocks to prevent memory issues
      const batchSize = block.transactions.length > 500 ? 10 : 20;

      for (let i = 0; i < block.transactions.length; i += batchSize) {
        const batch = block.transactions.slice(i, i + batchSize);
        const batchResults = await this.processTransactionBatch(batch, chainId);

        // Tally results
        confirmedCount += batchResults.confirmedCount;
        failedCount += batchResults.failedCount;
      }
    } catch (error) {
      this.logger.error(`Error processing chain ${chainId} transactions for block #${block.number}: ${error.message}`);
      // Add a reasonable default - assume all transactions are confirmed since we can't verify
      confirmedCount = block.transactions.length;
    }

    return { confirmedCount, failedCount };
  }

  /**
   * Process a batch of transactions
   */
  private async processTransactionBatch(
    batch: Array<string | { hash: string }>,
    chainId: string,
  ): Promise<{ confirmedCount: number; failedCount: number }> {
    let confirmedCount = 0;
    let failedCount = 0;

    // Process batch with timeout to prevent hanging
    const batchResults = await Promise.allSettled(
      batch.map(async (txIdentifier: string | { hash: string }) => {
        try {
          // Safely access transaction hash depending on type
          const transactionHash = typeof txIdentifier === 'string' ? txIdentifier : txIdentifier.hash;

          const txResult = await this.blockchainService.getTransaction(transactionHash);
          return { hash: transactionHash, result: txResult };
        } catch (txError) {
          // Safe error logging with explicit typing
          const txId = typeof txIdentifier === 'string' ? txIdentifier : txIdentifier.hash;
          this.logger.error(`Error processing chain ${chainId} transaction ${txId}: ${txError.message}`);
          return { hash: txId, error: txError };
        }
      }),
    );

    // Process batch results
    for (const result of batchResults) {
      if (result.status === 'fulfilled' && result.value.result) {
        const txResult = result.value.result;
        if (txResult.status === 'confirmed') {
          confirmedCount++;
        } else if (txResult.status === 'failed') {
          failedCount++;
        }
      } else if (result.status === 'rejected') {
        // Count failed tx processing as confirmed since we can't determine status
        confirmedCount++;
      }
    }

    return { confirmedCount, failedCount };
  }

  /**
   * Process block height variance for a new block
   */
  private processBlockHeightVariance(block: BlockInfo, networkKey: string): void {
    try {
      // Initialize _networkBlocks if needed
      if (!this._networkBlocks) {
        this._networkBlocks = {
          [NETWORK_MAINNET]: {},
          [NETWORK_TESTNET]: {},
        };
      }

      // Store the block in our tracking structure
      const blockKey = `block-${block.number}-${block.hash.substring(0, 8)}`;
      this._networkBlocks[networkKey][blockKey] = block.number;

      // Check if it's time to calculate block height variance
      this.checkAndUpdateBlockHeightVariance(networkKey);
    } catch (error) {
      this.logger.error(`Error processing block height variance: ${error.message}`);
    }
  }

  /**
   * Check if it's time to update block height variance and do so if needed
   */
  private checkAndUpdateBlockHeightVariance(networkKey: string): void {
    const now = Date.now();
    const intervalMs = this.settings.blockMonitoring.blockHeightVarianceCheckIntervalMs;

    if (!this.lastVarianceCheckTime || this.lastVarianceCheckTime < now - intervalMs) {
      this.lastVarianceCheckTime = now;

      // Calculate variance for the current network using our tracked blocks
      const variance = this.calculateBlockHeightVariance(networkKey, { rpcBlocks: this._networkBlocks[networkKey] });

      // Record metrics for the variance
      const chainId =
        networkKey === NETWORK_MAINNET
          ? BLOCKCHAIN.CHAIN_IDS.MAINNET.toString()
          : BLOCKCHAIN.CHAIN_IDS.TESTNET.toString();

      this.metricsService.setBlockHeightVariance(chainId, variance);
    }
  }

  /**
   * Calculate block height variance for a network from monitoring data
   */
  private calculateBlockHeightVariance(networkKey: string, networkInfo?: any): number {
    try {
      const rpcBlocks = networkInfo?.rpcBlocks || {};
      const blockHeights = Object.values(rpcBlocks).map(height => Number(height));

      if (blockHeights.length < 2) {
        return 0;
      }

      const minHeight = Math.min(...blockHeights);
      const maxHeight = Math.max(...blockHeights);
      return maxHeight - minHeight;
    } catch (error) {
      this.logger.error(`Error calculating block height variance: ${error.message}`);
      return 0;
    }
  }

  /**
   * Create TimeWindowData instance with standard configuration
   */
  private createTimeWindowData(
    windowDurationMs: number,
    maxDataPoints: number = RECENT_BLOCKS_SAMPLE_SIZE,
  ): TimeWindowData {
    return new TimeWindowData({
      windowDurationMs,
      maxDataPoints,
    });
  }

  /**
   * Create a network-keyed record of TimeWindowData instances
   */
  private createNetworkTimeWindows(windowDurationMs: number): Record<string, TimeWindowData> {
    return {
      [NETWORK_MAINNET]: this.createTimeWindowData(windowDurationMs),
      [NETWORK_TESTNET]: this.createTimeWindowData(windowDurationMs),
    };
  }

  /**
   * Get network key from chain ID
   */
  private getNetworkKey(chainId: number | string): string {
    const parsedChainId = typeof chainId === 'string' ? parseInt(chainId, 10) : chainId;
    return (
      CHAIN_ID_TO_NETWORK[parsedChainId] || (parsedChainId === MAINNET_CHAIN_ID ? NETWORK_MAINNET : NETWORK_TESTNET)
    );
  }

  /**
   * Get primary endpoint for a chain
   */
  private getPrimaryEndpoint(chainId: number): string {
    return chainId === MAINNET_CHAIN_ID ? this.mainnetPrimaryEndpoint : this.testnetPrimaryEndpoint;
  }
}
