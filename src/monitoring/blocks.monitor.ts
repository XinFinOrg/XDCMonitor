import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { BlockchainService } from '@blockchain/blockchain.service';
import { ConfigService, RpcEndpoint } from '@config/config.service';
import { BlockInfo } from '@models/block.interface';
import { TransactionInfo, TransactionStatus } from '@models/transaction.interface';
import { RpcMonitorService } from './rpc.monitor';
import { MetricsService } from '@metrics/metrics.service';

interface RpcBlockInfo {
  endpoint: string;
  blockNumber: number;
  responseTime: number;
  timestamp: number;
}

@Injectable()
export class BlocksMonitorService implements OnModuleInit {
  private readonly logger = new Logger(BlocksMonitorService.name);
  private lastBlockTime: number = 0;
  private blockInterval: NodeJS.Timeout;
  private lastBlockNumber: number = 0;
  private lastRpcResponseTime: number = 0;
  private rpcBlockInfo: Map<string, RpcBlockInfo> = new Map();
  private lastBlockTimestamp: number = 0;

  constructor(
    private readonly blockchainService: BlockchainService,
    private readonly configService: ConfigService,
    private readonly rpcMonitorService: RpcMonitorService,
    private readonly metricsService: MetricsService,
  ) {}

  onModuleInit() {
    if (this.configService.enableBlockMonitoring === true) {
      this.logger.log('Block monitoring is explicitly enabled in configuration. Starting monitoring...');
      this.startMonitoringBlocks();
    } else {
      this.logger.log('Block monitoring is disabled in configuration. Blocks and transactions will NOT be monitored.');
      if (this.blockInterval) {
        clearInterval(this.blockInterval);
        this.blockInterval = null;
      }
    }
  }

  startMonitoringBlocks() {
    if (this.configService.enableBlockMonitoring !== true) {
      this.logger.log('Block monitoring is explicitly disabled. Skipping setup of block monitoring.');
      return;
    }

    this.logger.log('Block monitoring is enabled. Setting up block scanning interval.');

    const interval = this.configService.scanInterval * 1000 || 15000;

    if (this.blockInterval) {
      clearInterval(this.blockInterval);
    }

    this.blockInterval = setInterval(() => {
      this.monitorBlocks();
    }, interval);

    this.monitorBlocks();
  }

  async monitorBlocks() {
    if (this.configService.enableBlockMonitoring !== true) {
      this.logger.debug('Block monitoring is disabled via configuration. Skipping block scanning completely.');
      return;
    }

    try {
      this.logger.debug('Monitoring block propagation across all RPC endpoints...');

      const rpcStatuses = this.rpcMonitorService.getAllRpcStatuses();
      this.logger.debug(`Found ${rpcStatuses.length} RPC endpoints in total`);

      const activeEndpoints = rpcStatuses.filter(endpoint => endpoint.status === 'up');

      this.logger.debug(`Found ${activeEndpoints.length} active RPC endpoints`);

      if (activeEndpoints.length === 0) {
        this.logger.warn('No active RPC endpoints available for block monitoring!');
        return;
      }

      // Group endpoints by network to ensure we monitor both mainnet and testnet
      const mainnetEndpoints = activeEndpoints.filter(endpoint => endpoint.isMainnet === true);
      const testnetEndpoints = activeEndpoints.filter(endpoint => endpoint.isMainnet === false);

      this.logger.debug(
        `Found ${mainnetEndpoints.length} mainnet endpoints and ${testnetEndpoints.length} testnet endpoints.`,
      );

      // Get block heights from ALL RPC endpoints independently
      const endpointPromises = activeEndpoints.map(async endpoint => {
        try {
          const startTime = Date.now();
          const blockNumber = await this.blockchainService.getLatestBlockNumber(endpoint.url);
          const responseTime = Date.now() - startTime;

          const info: RpcBlockInfo = {
            endpoint: endpoint.url,
            blockNumber,
            responseTime,
            timestamp: Date.now(),
          };

          this.rpcBlockInfo.set(endpoint.url, info);

          // Get network ID directly from the endpoint configuration
          const endpointNetworkId = endpoint.isMainnet ? '50' : '51';

          // Set block height metric with explicit network ID
          this.metricsService.setBlockHeight(blockNumber, endpoint.url, endpointNetworkId);
          this.logger.debug(
            `Set block height for ${endpoint.name} (${endpoint.url}, network ${endpointNetworkId}): ${blockNumber}`,
          );

          // Record RPC latency metric
          this.metricsService.recordRpcLatency(endpoint.url, responseTime, endpoint.isMainnet);

          if (responseTime > 1000) {
            this.logger.warn(
              `Slow RPC response detected on ${endpoint.name} (${endpoint.url})! Response time: ${responseTime}ms`,
            );
          } else {
            this.logger.debug(`RPC response time for ${endpoint.name}: ${responseTime}ms`);
          }

          return info;
        } catch (error) {
          this.logger.error(`Error monitoring blocks on ${endpoint.name} (${endpoint.url}): ${error.message}`);
          this.metricsService.setRpcStatus(endpoint.url, false, endpoint.isMainnet);
          return null;
        }
      });

      const results = await Promise.all(endpointPromises);
      const validResults = results.filter(r => r !== null);

      this.logger.debug(`Successfully monitored ${validResults.length} out of ${activeEndpoints.length} endpoints`);

      // Find highest block number for transaction processing (from the active provider's network)
      const activeProvider = this.blockchainService.getActiveProvider();
      const activeNetworkId = activeProvider.endpoint.isMainnet ? '50' : '51';
      const activeNetworkResults = validResults.filter(r => {
        const endpoint = activeEndpoints.find(e => e.url === r.endpoint);
        return endpoint && endpoint.isMainnet === activeProvider.endpoint.isMainnet;
      });

      if (activeNetworkResults.length > 0) {
        // Get the highest block number among active network endpoints
        const blockNumbers = activeNetworkResults.map(r => r.blockNumber);
        const highestBlockNumber = Math.max(...blockNumbers);

        // Only process new blocks we haven't seen before
        if (highestBlockNumber > this.lastBlockNumber) {
          this.logger.log(
            `New block detected on ${activeProvider.endpoint.isMainnet ? 'mainnet' : 'testnet'}: #${highestBlockNumber} (previous: #${this.lastBlockNumber})`,
          );

          // Only fetch the full block if we need transaction details
          // Note: We could make this configurable if transaction processing is not always needed
          try {
            const fullBlock = await this.blockchainService.getBlockByNumber(highestBlockNumber);
            await this.processBlock(fullBlock, activeNetworkId);
          } catch (error) {
            this.logger.error(`Error fetching full block data for #${highestBlockNumber}: ${error.message}`);
          }

          // Update last seen block number
          this.lastBlockNumber = highestBlockNumber;
        } else {
          this.logger.debug(`No new blocks since last check. Current highest block: #${highestBlockNumber}`);
        }

        // Calculate block time based on timestamp differences
        if (this.lastBlockTimestamp > 0) {
          const blockTime = Math.floor((Date.now() - this.lastBlockTimestamp) / 1000);
          this.metricsService.setBlockTime(blockTime, activeNetworkId);

          if (blockTime > this.configService.blockTimeThreshold) {
            this.logger.warn(
              `Slow block time detected! Time since last block: ${blockTime}s - Threshold: ${this.configService.blockTimeThreshold}s`,
            );
          }
        }
        this.lastBlockTimestamp = Date.now();
      }

      // Group results by network ID for separate reporting/alerting
      const mainnetResults = validResults.filter(r => {
        const endpoint = activeEndpoints.find(e => e.url === r.endpoint);
        return endpoint && endpoint.isMainnet === true;
      });

      const testnetResults = validResults.filter(r => {
        const endpoint = activeEndpoints.find(e => e.url === r.endpoint);
        return endpoint && endpoint.isMainnet === false;
      });

      this.logger.debug(`Valid results: ${mainnetResults.length} mainnet, ${testnetResults.length} testnet`);

      // Check for block height discrepancies within each network
      if (mainnetResults.length > 1) {
        this.checkBlockDiscrepancies(mainnetResults, activeEndpoints, 'Mainnet');
      }

      if (testnetResults.length > 1) {
        this.checkBlockDiscrepancies(testnetResults, activeEndpoints, 'Testnet');
      }
    } catch (error) {
      this.logger.error(`Block monitoring error: ${error.message}`);
    }
  }

  // Helper method to check for block height discrepancies
  private checkBlockDiscrepancies(results: RpcBlockInfo[], activeEndpoints: RpcEndpoint[], networkName: string) {
    const blockNumbers = results.map(r => r.blockNumber);
    const maxBlock = Math.max(...blockNumbers);
    const minBlock = Math.min(...blockNumbers);

    if (maxBlock - minBlock > 3) {
      this.logger.warn(`${networkName} block height discrepancy detected! Difference: ${maxBlock - minBlock} blocks`);

      results.forEach(info => {
        const endpointName = activeEndpoints.find(e => e.url === info.endpoint)?.name || info.endpoint;
        this.logger.debug(
          `${networkName} endpoint ${endpointName}: Block #${info.blockNumber}, Response time: ${info.responseTime}ms`,
        );
      });
    } else {
      this.logger.debug(
        `${networkName} block heights are in sync across endpoints. Max difference: ${maxBlock - minBlock} blocks`,
      );
    }
  }

  private async processBlock(block: BlockInfo, networkId: string): Promise<void> {
    this.logger.log(`Processing block #${block.number}: ${block.transactions.length} transactions`);

    // Process transactions in the block
    let confirmedTxCount = 0;
    let failedTxCount = 0;

    if (block.transactions && block.transactions.length > 0) {
      // Fetch detailed transaction information to count successful and failed transactions
      try {
        // For larger blocks, we might want to limit this processing
        // If there are too many transactions, we'll process a subset
        const maxTxToProcess = Math.min(block.transactions.length, 100);

        // Process transactions
        for (let i = 0; i < maxTxToProcess; i++) {
          const txHash = block.transactions[i];
          const tx = await this.blockchainService.getTransaction(txHash);
          const result = tx ? await this.processTransaction(tx, networkId) : null;

          if (result) {
            if (result.status === TransactionStatus.CONFIRMED) {
              confirmedTxCount++;
            } else if (result.status === TransactionStatus.FAILED) {
              failedTxCount++;
            }
          }
        }

        // If we didn't process all transactions, estimate the rest based on the processed ones
        if (maxTxToProcess < block.transactions.length) {
          const remainingTx = block.transactions.length - maxTxToProcess;
          const confirmedRatio = confirmedTxCount / (confirmedTxCount + failedTxCount || 1);
          const estimatedAdditionalConfirmed = Math.round(remainingTx * confirmedRatio);
          const estimatedAdditionalFailed = remainingTx - estimatedAdditionalConfirmed;

          confirmedTxCount += estimatedAdditionalConfirmed;
          failedTxCount += estimatedAdditionalFailed;

          this.logger.debug(
            `Estimated additional transactions for large block: ${estimatedAdditionalConfirmed} confirmed, ${estimatedAdditionalFailed} failed`,
          );
        }

        // Always set metrics, even if counts are zero
        this.metricsService.setTransactionsPerBlock(block.number, confirmedTxCount, failedTxCount, networkId);

        this.logger.log(`Block #${block.number} transactions: ${confirmedTxCount} confirmed, ${failedTxCount} failed`);
      } catch (error) {
        this.logger.error(`Error processing transactions for block #${block.number}: ${error.message}`);
      }
    } else {
      // Even for blocks with no transactions, set the metrics
      this.metricsService.setTransactionsPerBlock(block.number, 0, 0, networkId);
    }

    // Increment transaction counter metrics
    if (confirmedTxCount > 0) {
      this.metricsService.incrementTransactionCount('confirmed', networkId);
    }

    if (failedTxCount > 0) {
      this.metricsService.incrementTransactionCount('failed', networkId);
    }
  }

  private async processTransaction(tx: TransactionInfo, networkId: string): Promise<TransactionInfo> {
    this.logger.debug(`Processing transaction ${tx.hash}`);

    // Track transaction in metrics
    switch (tx.status) {
      case TransactionStatus.CONFIRMED:
        this.metricsService.incrementTransactionCount('confirmed', networkId);
        break;
      case TransactionStatus.PENDING:
        this.metricsService.incrementTransactionCount('pending', networkId);
        break;
      case TransactionStatus.FAILED:
        this.metricsService.incrementTransactionCount('failed', networkId);
        break;
    }

    return tx;
  }

  isBlockMonitoringEnabled(): boolean {
    return this.configService.enableBlockMonitoring;
  }

  getBlockMonitoringInfo(): any {
    const rpcStatuses = this.rpcMonitorService.getAllRpcStatuses();

    const endpointInfo = Array.from(this.rpcBlockInfo.entries()).map(([url, info]) => {
      const endpointDetail = rpcStatuses.find(e => e.url === url);

      return {
        name: endpointDetail?.name || 'Unknown',
        url: info.endpoint,
        blockNumber: info.blockNumber,
        responseTime: `${info.responseTime}ms`,
        status: endpointDetail?.status || 'unknown',
        lastUpdated: new Date(info.timestamp).toISOString(),
      };
    });

    endpointInfo.sort((a, b) => b.blockNumber - a.blockNumber);

    let maxBlockDifference = 0;
    if (endpointInfo.length > 1) {
      const blockNumbers = endpointInfo.map(e => e.blockNumber);
      const maxBlock = Math.max(...blockNumbers);
      const minBlock = Math.min(...blockNumbers);
      maxBlockDifference = maxBlock - minBlock;
    }

    // Get active provider information
    const activeProvider = this.blockchainService.getActiveProvider();
    const activeRpcInfo = this.rpcBlockInfo.get(activeProvider.endpoint.url);
    const activeResponseTime = activeRpcInfo ? activeRpcInfo.responseTime : 0;

    return {
      enabled: this.configService.enableBlockMonitoring,
      primaryEndpoint: {
        lastBlockNumber: this.lastBlockNumber,
        lastRpcResponseTime: `${activeResponseTime}ms`,
      },
      blockTimeThreshold: `${this.configService.blockTimeThreshold}s`,
      scanInterval: `${this.configService.scanInterval}s`,
      monitoredEndpoints: endpointInfo,
      endpointCount: endpointInfo.length,
      activeEndpointCount: rpcStatuses.filter(e => e.status === 'up').length,
      blockHeightDiscrepancy: maxBlockDifference,
      syncStatus: maxBlockDifference <= 3 ? 'in-sync' : 'out-of-sync',
    };
  }
}
