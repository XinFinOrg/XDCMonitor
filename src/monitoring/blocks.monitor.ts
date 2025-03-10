import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { BlockchainService } from '@blockchain/blockchain.service';
import { ConfigService } from '@config/config.service';
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
      const rpcEndpoints = activeEndpoints.map(endpoint => endpoint.url);

      this.logger.debug(`Found ${rpcEndpoints.length} active RPC endpoints`);

      if (rpcEndpoints.length === 0) {
        this.logger.warn('No active RPC endpoints available for block monitoring!');
        return;
      }

      this.logger.debug(`Monitoring blocks on ${rpcEndpoints.length} active RPC endpoints`);

      const startTime = Date.now();
      const latestBlock = await this.blockchainService.getLatestBlock();
      const rpcResponseTime = Date.now() - startTime;

      // Only process new blocks we haven't seen before
      if (latestBlock.number > this.lastBlockNumber) {
        this.logger.log(`New block detected: #${latestBlock.number} (previous: #${this.lastBlockNumber})`);

        // Process the latest block to count transactions
        await this.processBlock(latestBlock);

        // Update last seen block number
        this.lastBlockNumber = latestBlock.number;
      } else {
        this.logger.debug(`No new blocks since last check. Current block: #${latestBlock.number}`);
      }

      this.lastRpcResponseTime = rpcResponseTime;
      this.metricsService.setBlockHeight(latestBlock.number);

      if (rpcResponseTime > 1000) {
        this.logger.warn(`Slow RPC response detected on primary endpoint! Response time: ${rpcResponseTime}ms`);
      }

      this.metricsService.recordRpcLatency('primary', rpcResponseTime);

      // Get the previous block to calculate actual block time
      try {
        const previousBlockNumber = latestBlock.number - 1;
        if (previousBlockNumber > 0) {
          const previousBlock = await this.blockchainService.getBlockByNumber(previousBlockNumber);

          // Calculate block time by comparing block timestamps
          const latestBlockTimestamp =
            typeof latestBlock.timestamp === 'string' ? parseInt(latestBlock.timestamp, 16) : latestBlock.timestamp;
          const previousBlockTimestamp =
            typeof previousBlock.timestamp === 'string'
              ? parseInt(previousBlock.timestamp, 16)
              : previousBlock.timestamp;
          const blockTime = latestBlockTimestamp - previousBlockTimestamp;

          this.metricsService.setBlockTime(blockTime);

          if (blockTime > this.configService.blockTimeThreshold) {
            this.logger.warn(
              `Slow block detected! Block #${latestBlock.number} time: ${blockTime}s - Threshold: ${this.configService.blockTimeThreshold}s`,
            );
          } else {
            this.logger.debug(
              `Block #${latestBlock.number} time: ${blockTime}s (within threshold of ${this.configService.blockTimeThreshold}s)`,
            );
          }
        }
      } catch (error) {
        this.logger.error(`Error calculating block time: ${error.message}`);
      }

      const endpointPromises = activeEndpoints.map(async endpoint => {
        try {
          const startTime = Date.now();
          const blockData = await this.blockchainService.getLatestBlockNumber(endpoint.url);
          const responseTime = Date.now() - startTime;

          const info: RpcBlockInfo = {
            endpoint: endpoint.url,
            blockNumber: blockData,
            responseTime,
            timestamp: Date.now(),
          };

          this.rpcBlockInfo.set(endpoint.url, info);

          this.metricsService.recordRpcLatency(endpoint.url, responseTime);

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
          this.metricsService.setRpcStatus(endpoint.url, false);
          return null;
        }
      });

      const results = await Promise.all(endpointPromises);
      const validResults = results.filter(r => r !== null);

      this.logger.debug(`Successfully monitored ${validResults.length} out of ${activeEndpoints.length} endpoints`);

      if (validResults.length > 1) {
        const blockNumbers = validResults.map(r => r.blockNumber);
        const maxBlock = Math.max(...blockNumbers);
        const minBlock = Math.min(...blockNumbers);

        if (maxBlock - minBlock > 3) {
          this.logger.warn(`Block height discrepancy detected! Difference: ${maxBlock - minBlock} blocks`);

          validResults.forEach(info => {
            const endpointName = activeEndpoints.find(e => e.url === info.endpoint)?.name || info.endpoint;
            this.logger.debug(
              `Endpoint ${endpointName}: Block #${info.blockNumber}, Response time: ${info.responseTime}ms`,
            );
          });
        } else {
          this.logger.debug(
            `Block heights are in sync across endpoints. Max difference: ${maxBlock - minBlock} blocks`,
          );
        }
      }
    } catch (error) {
      this.logger.error(`Block monitoring error: ${error.message}`);
    }
  }

  private async processBlock(block: BlockInfo): Promise<void> {
    this.logger.log(`Processing block #${block.number}: ${block.transactions.length} transactions`);

    // Update metrics for this block
    this.metricsService.setBlockHeight(block.number);

    if (block.transactions && block.transactions.length > 0) {
      // Fetch detailed transaction information to count successful and failed transactions
      try {
        let confirmedCount = 0;
        let failedCount = 0;

        // For larger blocks, we might want to limit this processing
        // If there are too many transactions, we'll process a subset
        const maxTxToProcess = Math.min(block.transactions.length, 50);
        const txsToProcess = block.transactions.slice(0, maxTxToProcess);

        this.logger.debug(
          `Processing ${txsToProcess.length} out of ${block.transactions.length} transactions for block #${block.number}`,
        );

        const txPromises = txsToProcess.map(txHash =>
          this.blockchainService
            .getTransaction(txHash)
            .then(tx => this.processTransaction(tx))
            .catch(err => {
              this.logger.error(`Error processing transaction ${txHash}: ${err.message}`);
              return null;
            }),
        );

        const txResults = await Promise.all(txPromises);

        // Count confirmed and failed transactions
        txResults.forEach(result => {
          if (result) {
            if (result.status === TransactionStatus.CONFIRMED) {
              confirmedCount++;
            } else if (result.status === TransactionStatus.FAILED) {
              failedCount++;
            }
          }
        });

        // If we didn't process all transactions but we know they're confirmed (since they're in a block),
        // we can estimate the total confirmed count
        if (maxTxToProcess < block.transactions.length) {
          const remainingTx = block.transactions.length - maxTxToProcess;
          const confirmedRatio = confirmedCount / (confirmedCount + failedCount || 1);
          const estimatedAdditionalConfirmed = Math.round(remainingTx * confirmedRatio);
          const estimatedAdditionalFailed = remainingTx - estimatedAdditionalConfirmed;

          confirmedCount += estimatedAdditionalConfirmed;
          failedCount += estimatedAdditionalFailed;

          this.logger.debug(
            `Estimated additional transactions: ${estimatedAdditionalConfirmed} confirmed, ${estimatedAdditionalFailed} failed`,
          );
        }

        // Always set metrics, even if counts are zero
        this.metricsService.setTransactionsPerBlock(block.number, confirmedCount, failedCount);

        this.logger.log(`Block #${block.number} transactions: ${confirmedCount} confirmed, ${failedCount} failed`);
      } catch (error) {
        this.logger.error(`Error processing transactions for block #${block.number}: ${error.message}`);
        // Even on error, try to set transaction metrics
        this.metricsService.setTransactionsPerBlock(block.number, block.transactions.length, 0);
      }
    } else {
      this.logger.debug(`Block #${block.number} has no transactions`);
      this.metricsService.setTransactionsPerBlock(block.number, 0, 0);
    }
  }

  private async processTransaction(tx: TransactionInfo): Promise<TransactionInfo> {
    this.logger.debug(`Processing transaction ${tx.hash}`);

    // Track transaction in metrics
    switch (tx.status) {
      case TransactionStatus.CONFIRMED:
        this.metricsService.incrementTransactionCount('confirmed');
        break;
      case TransactionStatus.PENDING:
        this.metricsService.incrementTransactionCount('pending');
        break;
      case TransactionStatus.FAILED:
        this.metricsService.incrementTransactionCount('failed');
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

    return {
      enabled: this.configService.enableBlockMonitoring,
      primaryEndpoint: {
        lastBlockNumber: this.lastBlockNumber,
        lastRpcResponseTime: `${this.lastRpcResponseTime}ms`,
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
