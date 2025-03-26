import { BlockchainService } from '@blockchain/blockchain.service';
import {
  CHAIN_ID_TO_NETWORK,
  NETWORK_MAINNET,
  NETWORK_TESTNET,
  RECENT_BLOCKS_SAMPLE_SIZE,
  TRANSACTION_HISTORY_WINDOW_MS,
} from '@common/constants/block-monitoring';
import { ALERTS, BLOCKCHAIN, PERFORMANCE } from '@common/constants/config';
import { MAINNET_CHAIN_ID, TESTNET_CHAIN_ID } from '@common/constants/endpoints';
import { RpcRetryClient } from '@common/utils/rpc-retry-client';
import { TimeWindowData } from '@common/utils/time-window-data';
import { ConfigService } from '@config/config.service';
import { MetricsService } from '@metrics/metrics.service';
import { AlertsService } from '@monitoring/alerts.service';
import { RpcMonitorService } from '@monitoring/rpc.monitor';
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { SchedulerRegistry } from '@nestjs/schedule';
import { BlockInfo, BlockMonitoringInfo, NetworkConfig, PrimaryEndpointStatus } from '@types';

// Core constants
const DOWNTIME_NOTIFICATION_THRESHOLD_MS = 60 * 60 * 1000; // 1 hour
const DEFAULT_BATCH_SIZE = 20;

// Network configurations
const SUPPORTED_CHAINS = [
  { key: NETWORK_MAINNET, chainId: MAINNET_CHAIN_ID, defaultRpc: BLOCKCHAIN.RPC.DEFAULT_MAINNET_RPC },
  { key: NETWORK_TESTNET, chainId: TESTNET_CHAIN_ID, defaultRpc: BLOCKCHAIN.RPC.DEFAULT_TESTNET_RPC },
];

/**
 * Service for monitoring blocks across XDC networks
 */
@Injectable()
export class BlocksMonitorService implements OnModuleInit {
  private readonly logger = new Logger(BlocksMonitorService.name);
  private readonly intervalName = 'blockMonitoring';

  // Configuration
  private monitoringEnabled = false;
  private scanIntervalMs: number;
  private readonly timing = { startupDelay: 5000, errorRecoveryDelay: 10000, initialScanDelay: 3000 };

  // Network state
  private networks: Record<string, NetworkConfig> = {};
  private primaryEndpointStatus: Record<number, PrimaryEndpointStatus> = {};
  private endpointBlockHeights: Record<string, Record<string, number>> = {
    [NETWORK_MAINNET]: {},
    [NETWORK_TESTNET]: {},
  };

  // Data tracking
  private recentBlockTimes: Record<string, TimeWindowData>;
  private transactionCounts: Record<string, TimeWindowData>;
  private failedTransactions: Record<string, TimeWindowData>;

  constructor(
    private readonly blockchainService: BlockchainService,
    private readonly configService: ConfigService,
    private readonly rpcMonitorService: RpcMonitorService,
    private readonly metricsService: MetricsService,
    private readonly alertsService: AlertsService,
    private readonly schedulerRegistry: SchedulerRegistry,
  ) {
    this.initializeService();
  }

  /**
   * Initialize all service components
   */
  private initializeService(): void {
    this.initTimeWindows();
    this.loadConfig();
    this.initNetworks();
  }

  async onModuleInit() {
    try {
      this.refreshConfig();
      this.initEndpointStatusTracking();
      await this.initRpcClients();

      if (this.monitoringEnabled) {
        await this.initializeEndpointBlockHeights();
        await this.updateToBestEndpoints();

        setTimeout(() => this.startMonitoring(), this.timing.startupDelay);
      }
    } catch (error) {
      this.logger.error(`Failed to initialize block monitoring service: ${error.message}`);
      if (this.monitoringEnabled) {
        setTimeout(() => this.startMonitoring(), this.timing.errorRecoveryDelay);
      }
    }
  }

  /**
   * Stop monitoring when module is destroyed
   */
  onModuleDestroy() {
    this.stopMonitoring();
  }

  private initTimeWindows(): void {
    // Create time windows with common configs
    const createTimeWindows = (config: any) => ({
      [NETWORK_MAINNET]: new TimeWindowData(config),
      [NETWORK_TESTNET]: new TimeWindowData(config),
    });

    this.recentBlockTimes = createTimeWindows({
      windowDurationMs: 24 * 60 * 60 * 1000,
      maxDataPoints: RECENT_BLOCKS_SAMPLE_SIZE,
    });

    const txConfig = {
      windowDurationMs: TRANSACTION_HISTORY_WINDOW_MS,
      maxDataPoints: RECENT_BLOCKS_SAMPLE_SIZE,
    };

    this.transactionCounts = createTimeWindows(txConfig);
    this.failedTransactions = createTimeWindows(txConfig);
  }

  private loadConfig(): void {
    this.scanIntervalMs = this.configService.scanInterval || BLOCKCHAIN.BLOCKS.DEFAULT_SCAN_INTERVAL_MS;
    this.monitoringEnabled = this.configService.enableBlockMonitoring;
  }

  private refreshConfig(): void {
    this.scanIntervalMs = this.configService.scanInterval || 15000;
    this.monitoringEnabled = this.configService.enableBlockMonitoring;
    this.updateNetworkEndpoints();
    this.logger.log(
      `Block monitoring: ${this.monitoringEnabled ? 'enabled' : 'disabled'}, interval: ${this.scanIntervalMs}ms`,
    );
  }

  private initNetworks(): void {
    // Initialize networks from supported chains
    SUPPORTED_CHAINS.forEach(({ key, chainId, defaultRpc }) => {
      const primaryEndpoint = this.configService.getPrimaryRpcUrl(chainId) || defaultRpc;
      this.networks[key] = {
        primaryEndpoint,
        endpoints: [],
        client: this.createRpcClient(primaryEndpoint),
        chainId,
      };
    });

    this.loadAdditionalEndpoints();
  }

  private updateNetworkEndpoints(): void {
    SUPPORTED_CHAINS.forEach(({ key, chainId }) => {
      this.networks[key].primaryEndpoint = this.configService.getPrimaryRpcUrl(chainId);
    });
  }

  private loadAdditionalEndpoints(): void {
    SUPPORTED_CHAINS.forEach(({ key, chainId }) => {
      const endpoints = this.configService
        .getRpcEndpoints()
        .filter(endpoint => endpoint.chainId === chainId && endpoint.type === 'rpc')
        .map(endpoint => endpoint.url);

      if (endpoints.length > 0) {
        this.networks[key].endpoints = endpoints;
        this.networks[key].client.setFallbackUrls(endpoints);
      }
    });
  }

  private async initRpcClients(): Promise<void> {
    try {
      this.logger.log('Initializing RPC clients for block monitoring...');
      const options = { maxRetries: 5, retryDelayMs: 1000, timeoutMs: 10000 };

      // Create clients for all supported chains
      SUPPORTED_CHAINS.forEach(({ key }) => {
        this.networks[key].client = this.createRpcClient(this.networks[key].primaryEndpoint, options);
      });

      // Test connections in parallel
      const results = await Promise.all(
        SUPPORTED_CHAINS.map(({ key }) => this.networks[key].client.call('eth_chainId').catch(() => null)),
      );

      const statusSummary = SUPPORTED_CHAINS.map((net, i) => `${net.key}: ${!!results[i]}`).join(', ');
      this.logger.log(`RPC clients initialized - ${statusSummary}`);
    } catch (error) {
      this.logger.error(`Error initializing RPC clients: ${error.message}`);
      throw error;
    }
  }

  private createRpcClient(
    endpoint: string,
    options: Partial<{ maxRetries: number; retryDelayMs: number; timeoutMs: number }> = {},
  ): RpcRetryClient {
    return new RpcRetryClient(endpoint, {
      maxRetries: options.maxRetries || PERFORMANCE.RPC_CLIENT.MAX_RETRY_ATTEMPTS,
      retryDelayMs: options.retryDelayMs || PERFORMANCE.RPC_CLIENT.RETRY_DELAY_MS,
      timeoutMs: options.timeoutMs || PERFORMANCE.RPC_CLIENT.DEFAULT_TIMEOUT_MS,
    });
  }

  private initEndpointStatusTracking(): void {
    SUPPORTED_CHAINS.forEach(({ chainId }) => {
      const networkKey = this.getNetworkKey(chainId);
      this.primaryEndpointStatus[chainId] = {
        url: this.networks[networkKey].primaryEndpoint,
        chainId,
        downSince: undefined,
        alerted: false,
      };
    });
  }

  /**
   * Initialize block heights for all endpoints at startup
   */
  private async initializeEndpointBlockHeights(): Promise<void> {
    this.logger.log('Finding best endpoints for monitoring...');

    try {
      // Check endpoints for all supported chains in parallel
      await Promise.all(SUPPORTED_CHAINS.map(({ chainId }) => this.findEndpointBlockHeights(chainId)));

      // Log discovered best endpoints
      const bestEndpoints = SUPPORTED_CHAINS.map(({ key }) => {
        const best = this.getBestEndpoint(key);
        return `${key}: ${best || 'none found'}`;
      }).join(', ');

      this.logger.log(`Initial endpoint selection - ${bestEndpoints}`);
    } catch (error) {
      this.logger.error(`Error initializing endpoint block heights: ${error.message}`);
    }
  }

  /**
   * Find block heights for all endpoints of a specific chain
   */
  private async findEndpointBlockHeights(chainId: number): Promise<void> {
    const networkKey = this.getNetworkKey(chainId);
    const network = this.networks[networkKey];

    if (!network) {
      this.logger.error(`Network configuration not found for chain ${chainId}`);
      return;
    }

    // Initialize if not already present
    if (!this.endpointBlockHeights[networkKey]) {
      this.endpointBlockHeights[networkKey] = {};
    }

    // Get all RPC endpoints for this chain
    const allRpcEndpoints = this.configService
      .getRpcEndpoints()
      .filter(endpoint => endpoint.chainId === chainId && endpoint.type === 'rpc')
      .map(endpoint => endpoint.url);

    // Check all endpoints in parallel with timeout
    await Promise.all(
      allRpcEndpoints.map(endpoint =>
        this.checkEndpointBlockHeight(endpoint, chainId, networkKey).catch(err =>
          this.logger.warn(`Failed to check endpoint ${endpoint}: ${err.message}`),
        ),
      ),
    );
  }

  /**
   * Update network configurations to use the best endpoints
   */
  private async updateToBestEndpoints(): Promise<void> {
    // Update all networks to use their best endpoint
    for (const { key, chainId } of SUPPORTED_CHAINS) {
      const bestEndpoint = this.getBestEndpoint(key);
      if (bestEndpoint) {
        this.networks[key].primaryEndpoint = bestEndpoint;
        this.networks[key].client = this.createRpcClient(bestEndpoint);
        this.primaryEndpointStatus[chainId].url = bestEndpoint;
        this.logger.log(`Updated ${key} primary endpoint to: ${bestEndpoint}`);
      }
    }

    // Reinitialize RPC clients with the best endpoints
    await this.initRpcClients();
  }
  // #endregion

  // #region Monitoring Control

  public startMonitoring(): void {
    this.monitoringEnabled = true;
    this.logger.log('Starting block monitoring');
    setTimeout(() => {
      this.monitorBlocks();
      this.updateMonitoringInterval();
    }, this.timing.initialScanDelay);
  }

  public stopMonitoring(): void {
    this.logger.log('Stopping block monitoring');
    this.monitoringEnabled = false;

    try {
      this.schedulerRegistry.deleteInterval(this.intervalName);
      this.logger.log('Monitoring interval deleted');
    } catch (e) {
      this.logger.debug(`No interval found to delete: ${e.message}`);
    }
  }

  private updateMonitoringInterval(): void {
    try {
      // Remove existing interval if present
      try {
        this.schedulerRegistry.deleteInterval(this.intervalName);
      } catch (e) {
        // Ignore if interval doesn't exist
      }

      // Create and register new interval
      const interval = setInterval(() => this.monitorBlocks(), this.scanIntervalMs);
      this.schedulerRegistry.addInterval(this.intervalName, interval);
      this.logger.log(`Block monitoring interval set to ${this.scanIntervalMs}ms`);
    } catch (error) {
      this.logger.error(`Failed to update monitoring interval: ${error.message}`);
    }
  }

  public isBlockMonitoringEnabled(): boolean {
    return this.monitoringEnabled;
  }

  private async monitorBlocks(): Promise<void> {
    if (!this.monitoringEnabled) return;

    try {
      this.logger.debug('Running block monitoring cycle');
      await Promise.all(SUPPORTED_CHAINS.map(({ chainId }) => this.checkChain(chainId)));
    } catch (error) {
      this.logger.error(`Monitoring error: ${error.message}`);
    }
  }

  private async checkChain(chainId: number): Promise<void> {
    this.logger.debug(`Checking chain ${chainId}`);
    const networkKey = this.getNetworkKey(chainId);
    const network = this.networks[networkKey];

    if (!network || !network.client) {
      this.logger.error(`Network configuration not found for chain ${chainId}`);
      return;
    }

    try {
      // First check all endpoints to find the one with highest block
      await this.checkAllEndpoints(chainId, network);

      // Process data from the best endpoint
      const bestEndpoint = this.getBestEndpoint(networkKey);
      if (bestEndpoint) {
        const blockHeight = this.endpointBlockHeights[networkKey][bestEndpoint];
        await this.processLatestBlockData(chainId, bestEndpoint, blockHeight);
      }
    } catch (error) {
      this.logger.error(`Error checking chain ${chainId}: ${error.message}`);
    }
  }

  private async checkAllEndpoints(chainId: number, network: NetworkConfig): Promise<void> {
    const networkKey = this.getNetworkKey(chainId);
    this.endpointBlockHeights[networkKey] = {}; // Reset heights for this cycle

    // Get all RPC endpoints for this chain
    const allRpcEndpoints = this.rpcMonitorService
      .getAllRpcStatuses()
      .filter(endpoint => endpoint.chainId === chainId)
      .map(endpoint => endpoint.url);

    // Check all endpoints in parallel
    await Promise.all(allRpcEndpoints.map(endpoint => this.checkEndpointBlockHeight(endpoint, chainId, networkKey)));
  }

  private async checkEndpointBlockHeight(endpoint: string, chainId: number, networkKey: string): Promise<void> {
    try {
      // Create temporary client with short timeout
      const tempClient = new RpcRetryClient(endpoint, {
        maxRetries: 1,
        retryDelayMs: 500,
        timeoutMs: 3000,
      });

      // Get this endpoint's block height
      const blockNumberHex = await tempClient.call<string>(BLOCKCHAIN.RPC.METHODS.GET_BLOCK_NUMBER);
      if (!blockNumberHex) return;

      const blockNumber = parseInt(blockNumberHex, 16);
      if (!isNaN(blockNumber)) {
        // Store height and update metrics
        this.endpointBlockHeights[networkKey][endpoint] = blockNumber;
        this.metricsService.setBlockHeight(blockNumber, endpoint, chainId.toString());
        this.metricsService.setRpcStatus(endpoint, true, chainId);

        // Update status for primary endpoint if this is it
        if (endpoint === this.primaryEndpointStatus[chainId]?.url) {
          this.resetEndpointStatus(chainId);
        }
      }
    } catch (error) {
      this.metricsService.setRpcStatus(endpoint, false, chainId);

      // Handle primary endpoint error if this is it
      if (endpoint === this.primaryEndpointStatus[chainId]?.url) {
        this.handlePrimaryEndpointError(chainId, endpoint, error);
      }
    }
  }

  private getBestEndpoint(networkKey: string): string | null {
    const heights = this.endpointBlockHeights[networkKey];
    let bestEndpoint = null;
    let highestBlock = -1;

    // Find endpoint with highest block
    for (const [endpoint, height] of Object.entries(heights)) {
      if (height > highestBlock) {
        highestBlock = height;
        bestEndpoint = endpoint;
      }
    }

    return bestEndpoint;
  }

  private resetEndpointStatus(chainId: number): void {
    if (this.primaryEndpointStatus[chainId]) {
      this.primaryEndpointStatus[chainId].downSince = undefined;
      this.primaryEndpointStatus[chainId].alerted = false;
    }
  }

  private async processLatestBlockData(chainId: number, endpointUrl: string, latestBlock: number): Promise<void> {
    const networkKey = this.getNetworkKey(chainId);

    try {
      // Fetch current and previous blocks in parallel
      const [latestBlockData, previousBlockData] = await Promise.all([
        this.blockchainService.getBlockByNumberForChain(latestBlock, chainId),
        this.blockchainService.getBlockByNumberForChain(latestBlock - 1, chainId),
      ]);

      // Log block data for debugging
      if (latestBlockData) {
        this.logger.debug(
          `Block #${latestBlockData.number} data: ` +
            `transactions=${latestBlockData.transactions?.length || 0}, ` +
            `timestamp=${latestBlockData.timestamp}, ` +
            `hash=${latestBlockData.hash}`,
        );
      }

      // Calculate and record block time if both blocks are available
      if (latestBlockData && previousBlockData && previousBlockData.timestamp) {
        this.processBlockTime(latestBlockData, previousBlockData, networkKey, chainId);
      }

      // Process the block directly
      if (latestBlockData) {
        await this.processBlock(latestBlockData, chainId, endpointUrl);
      }
    } catch (error) {
      this.logger.error(`Error processing block data: ${error.message}`);
    }
  }

  private processBlockTime(
    latestBlock: BlockInfo,
    previousBlock: BlockInfo,
    networkKey: string,
    chainId: number,
  ): void {
    // Calculate the block time in seconds (timestamps are already in seconds)
    const blockTimeSeconds = (latestBlock.timestamp - previousBlock.timestamp) / 1000;

    // Only record valid block times (filter out negative values)
    if (blockTimeSeconds > 0) {
      this.recentBlockTimes[networkKey].addDataPoint(blockTimeSeconds);
      this.metricsService.setBlockTime(blockTimeSeconds, chainId);
    }
  }

  private handlePrimaryEndpointError(chainId: number, primaryEndpoint: string, error: Error): void {
    this.logger.error(`Primary endpoint ${primaryEndpoint} error: ${error.message}`);
    this.metricsService.setRpcStatus(primaryEndpoint, false, chainId);

    const status = this.primaryEndpointStatus[chainId] || {
      url: primaryEndpoint,
      chainId,
      downSince: undefined,
      alerted: false,
    };

    const now = Date.now();

    // If this is first error, record when it went down
    if (!status.downSince) {
      status.downSince = now;
      status.alerted = false;
      this.primaryEndpointStatus[chainId] = status;
      return;
    }

    // Check if it's been down for more than the threshold and we haven't sent an alert yet
    const downTimeMs = now - status.downSince;
    if (downTimeMs >= DOWNTIME_NOTIFICATION_THRESHOLD_MS && !status.alerted) {
      this.sendEndpointDownAlert(chainId, primaryEndpoint, status.downSince, error);
      status.alerted = true;
      this.primaryEndpointStatus[chainId] = status;
    }
  }

  private sendEndpointDownAlert(chainId: number, endpoint: string, downSince: number, error: Error): void {
    // Calculate downtime duration
    const downtimeMs = Date.now() - downSince;
    const downtimeHours = Math.floor(downtimeMs / (60 * 60 * 1000));
    const downtimeMinutes = Math.floor((downtimeMs % (60 * 60 * 1000)) / (60 * 1000));

    // Send notification
    this.alertsService.error(
      ALERTS.TYPES.RPC_ENDPOINT_DOWN,
      'rpc',
      `Primary RPC endpoint for chain ${chainId} has been down for ${downtimeHours}h ${downtimeMinutes}m: ${error.message}`,
      chainId,
    );
  }

  private async processBlock(block: BlockInfo, chainId: number, endpoint?: string): Promise<void> {
    if (!block || block.number === undefined) {
      throw new Error(`Invalid block data for chain ${chainId}`);
    }

    const networkKey = this.getNetworkKey(chainId);

    try {
      // Update metrics
      if (endpoint) {
        this.metricsService.setBlockHeight(block.number, endpoint, chainId.toString());
      }

      // Process transactions and update metrics
      const { confirmedCount, failedCount } = await this.processBlockTransactions(block, chainId);
      this.updateTransactionMetrics(block, chainId, networkKey, confirmedCount, failedCount);
    } catch (error) {
      this.logger.error(`Error processing block #${block.number}: ${error.message}`);
    }
  }

  private async processBlockTransactions(
    block: BlockInfo,
    chainId: number,
  ): Promise<{ confirmedCount: number; failedCount: number }> {
    if (!block.transactions?.length) {
      this.logger.debug(`No transactions in block #${block.number}`);
      return { confirmedCount: 0, failedCount: 0 };
    }

    try {
      // Determine optimal batch size based on transaction volume
      const batchSize = block.transactions.length > 500 ? 50 : DEFAULT_BATCH_SIZE;
      let confirmedCount = 0;
      let failedCount = 0;

      this.logger.debug(
        `Processing ${block.transactions.length} transactions in block #${block.number} with batch size ${batchSize}`,
      );

      // Process transactions in batches
      for (let i = 0; i < block.transactions.length; i += batchSize) {
        const batch = block.transactions.slice(i, i + batchSize);
        this.logger.debug(
          `Processing batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(block.transactions.length / batchSize)} ` +
            `for block #${block.number} (${batch.length} transactions)`,
        );

        const results = await this.processTransactionBatch(batch, chainId);
        confirmedCount += results.confirmedCount;
        failedCount += results.failedCount;

        this.logger.debug(
          `Batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(block.transactions.length / batchSize)} ` +
            `for block #${block.number}: ${results.confirmedCount} confirmed, ${results.failedCount} failed`,
        );
      }

      this.logger.debug(
        `Completed processing block #${block.number}: ${confirmedCount} confirmed, ${failedCount} failed`,
      );
      return { confirmedCount, failedCount };
    } catch (error) {
      this.logger.error(`Error processing transactions in block #${block.number}: ${error.message}`);
      // Assume all transactions are confirmed if we can't verify
      return { confirmedCount: block.transactions.length, failedCount: 0 };
    }
  }

  private async processTransactionBatch(
    batch: Array<string | { hash: string }>,
    chainId: number,
  ): Promise<{ confirmedCount: number; failedCount: number }> {
    // Process transactions in parallel
    const batchResults = await Promise.allSettled(
      batch.map(async txIdentifier => {
        try {
          const hash = typeof txIdentifier === 'string' ? txIdentifier : txIdentifier.hash;
          this.logger.debug(`Getting transaction status for ${hash}`);
          const tx = await this.blockchainService.getTransactionForChain(hash, chainId);
          this.logger.debug(`Transaction ${hash} status: ${tx.status}`);
          return tx;
        } catch (error) {
          this.logger.debug(`Failed to get transaction status: ${error.message}`);
          return null;
        }
      }),
    );

    // Count confirmed and failed transactions
    return batchResults.reduce(
      (counters, result) => {
        if (result.status === 'fulfilled' && result.value) {
          if (result.value.status === 'confirmed') {
            counters.confirmedCount++;
          } else if (result.value.status === 'failed') {
            counters.failedCount++;
          }
        } else {
          // Count as confirmed if we couldn't determine status
          counters.confirmedCount++;
        }
        return counters;
      },
      { confirmedCount: 0, failedCount: 0 },
    );
  }

  private updateTransactionMetrics(
    block: BlockInfo,
    chainId: number,
    networkKey: string,
    confirmedCount: number,
    failedCount: number,
  ): void {
    const totalTxs = block.transactions.length;

    this.logger.debug(
      `Updating transaction metrics for block #${block.number}: ` +
        `${totalTxs} total, ${confirmedCount} confirmed, ${failedCount} failed`,
    );

    // Update block and transaction metrics
    this.metricsService.setTransactionsPerBlock(block.number, totalTxs, confirmedCount, failedCount, chainId);

    // Update transaction history metrics
    this.transactionCounts[networkKey].addDataPoint(totalTxs);
    if (failedCount > 0) {
      this.failedTransactions[networkKey].addDataPoint(failedCount);
    }

    // Calculate and update transactions per minute
    const txSum = this.transactionCounts[networkKey].getSum();
    const minutes = TRANSACTION_HISTORY_WINDOW_MS / (60 * 1000);
    this.metricsService.setTransactionsPerMinute(txSum / minutes, chainId);
  }

  // #endregion

  // #region Status and Reporting

  getBlockMonitoringInfo(): BlockMonitoringInfo {
    try {
      const rpcStatuses = this.rpcMonitorService.getAllRpcStatuses();

      // Find current best endpoints
      const mainnetBestEndpoint =
        this.getBestEndpoint(NETWORK_MAINNET) || this.networks[NETWORK_MAINNET]?.primaryEndpoint;
      const testnetBestEndpoint =
        this.getBestEndpoint(NETWORK_TESTNET) || this.networks[NETWORK_TESTNET]?.primaryEndpoint;

      // Get filtered endpoints for each network
      const getNetworkEndpoints = (chainId: number) => rpcStatuses.filter(e => e.chainId === chainId).map(e => e.url);

      return {
        enabled: this.monitoringEnabled,
        primaryEndpoint: {
          mainnet: mainnetBestEndpoint,
          testnet: testnetBestEndpoint,
        },
        blockTimeThreshold: {
          error: BLOCKCHAIN.BLOCKS.BLOCK_TIME_ERROR_THRESHOLD,
        },
        scanInterval: this.scanIntervalMs,
        monitoredEndpoints: {
          mainnet: { endpoints: getNetworkEndpoints(MAINNET_CHAIN_ID) },
          testnet: { endpoints: getNetworkEndpoints(TESTNET_CHAIN_ID) },
        },
        rpcStatus: {
          mainnet: this.createStatusMap(rpcStatuses, MAINNET_CHAIN_ID),
          testnet: this.createStatusMap(rpcStatuses, TESTNET_CHAIN_ID),
        },
        blockHeightVariance: {
          mainnet: this.calculateBlockHeightVariance(NETWORK_MAINNET),
          testnet: this.calculateBlockHeightVariance(NETWORK_TESTNET),
        },
        queueStats: {
          size: 0,
          processing: 0,
          completed: 0,
        },
        blockTimeStats: {
          mainnet: this.getTimeWindowStats(NETWORK_MAINNET),
          testnet: this.getTimeWindowStats(NETWORK_TESTNET),
        },
      };
    } catch (error) {
      this.logger.error(`Error in monitoring info: ${error.message}`);
      return this.createFallbackMonitoringInfo();
    }
  }

  private calculateBlockHeightVariance(networkKey: string): number {
    const heights = Object.values(this.endpointBlockHeights[networkKey]);
    if (heights.length < 2) return 0;

    const max = Math.max(...heights);
    const min = Math.min(...heights);
    return max - min;
  }

  private createFallbackMonitoringInfo(): BlockMonitoringInfo {
    return {
      enabled: this.monitoringEnabled,
      primaryEndpoint: {
        mainnet: this.networks[NETWORK_MAINNET]?.primaryEndpoint || '',
        testnet: this.networks[NETWORK_TESTNET]?.primaryEndpoint || '',
      },
      blockTimeThreshold: { error: BLOCKCHAIN.BLOCKS.BLOCK_TIME_ERROR_THRESHOLD || 60 },
      scanInterval: this.scanIntervalMs || 15000,
      monitoredEndpoints: { mainnet: { endpoints: [] }, testnet: { endpoints: [] } },
      rpcStatus: { mainnet: {}, testnet: {} },
      blockHeightVariance: { mainnet: 0, testnet: 0 },
      queueStats: { size: 0, processing: 0, completed: 0 },
      blockTimeStats: {
        mainnet: { count: 0, average: 0 },
        testnet: { count: 0, average: 0 },
      },
    };
  }

  private getTimeWindowStats(network: string) {
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
      return { count: 0, average: 0 };
    }
  }

  private createStatusMap(rpcStatuses: any[], chainId: number): Record<string, boolean> {
    return rpcStatuses
      .filter(e => e.chainId === chainId)
      .reduce((acc, endpoint) => {
        acc[endpoint.url] = endpoint.status === 'active';
        return acc;
      }, {});
  }

  private getNetworkKey(chainId: number | string): string {
    const parsedChainId = typeof chainId === 'string' ? parseInt(chainId, 10) : chainId;
    return (
      CHAIN_ID_TO_NETWORK[parsedChainId] || (parsedChainId === MAINNET_CHAIN_ID ? NETWORK_MAINNET : NETWORK_TESTNET)
    );
  }
  // #endregion
}
