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
  private blockInterval: NodeJS.Timeout;
  private lastBlockNumber: number = 0;
  private rpcBlockInfo: Map<string, RpcBlockInfo> = new Map();

  private lastHighestBlockMainnet: number = 0;
  private lastHighestBlockTestnet: number = 0;

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
      const mainnetEndpoints = activeEndpoints.filter(endpoint => endpoint.chainId === 50);
      const testnetEndpoints = activeEndpoints.filter(endpoint => endpoint.chainId === 51);

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

          this.metricsService.setBlockHeight(blockNumber, endpoint.url, endpoint.chainId.toString());
          this.logger.debug(
            `Set block height for ${endpoint.name} (${endpoint.url}, chainId ${endpoint.chainId}): ${blockNumber}`,
          );

          // Record RPC latency metric
          this.metricsService.recordRpcLatency(endpoint.url, responseTime, endpoint.chainId);

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
          this.metricsService.setRpcStatus(endpoint.url, false, endpoint.chainId);
          return null;
        }
      });

      const results = await Promise.all(endpointPromises);
      const validResults = results.filter(r => r !== null);

      this.logger.debug(`Successfully monitored ${validResults.length} out of ${activeEndpoints.length} endpoints`);

      // Group results by chainId for separate reporting/alerting
      const mainnetResults = validResults.filter(r => {
        const endpoint = activeEndpoints.find(e => e.url === r.endpoint);
        return endpoint && endpoint.chainId === 50;
      });

      const testnetResults = validResults.filter(r => {
        const endpoint = activeEndpoints.find(e => e.url === r.endpoint);
        return endpoint && endpoint.chainId === 51;
      });

      this.logger.debug(`Valid results: ${mainnetResults.length} mainnet, ${testnetResults.length} testnet`);

      // Process Mainnet block time separately
      if (mainnetResults.length > 0) {
        const mainnetBlockNumbers = mainnetResults.map(r => r.blockNumber);
        const highestMainnetBlock = Math.max(...mainnetBlockNumbers);

        // Check if we've seen a new block
        if (highestMainnetBlock > this.lastHighestBlockMainnet) {
          this.logger.debug(
            `New Mainnet block detected: #${highestMainnetBlock} (previous: #${this.lastHighestBlockMainnet})`,
          );

          try {
            // Fetch the full block with timestamp
            const fullMainnetBlock = await this.blockchainService.getBlockByNumberForChain(highestMainnetBlock, 50);
            const previousMainnetBlock = await this.blockchainService.getBlockByNumberForChain(
              highestMainnetBlock - 1,
              50,
            );

            if (previousMainnetBlock) {
              const mainnetBlockTime = fullMainnetBlock.timestamp - previousMainnetBlock.timestamp;
              this.metricsService.setBlockTime(mainnetBlockTime, 50); // 50 = Mainnet

              this.logger.debug(`Mainnet block time based on block timestamps: ${mainnetBlockTime}s`);

              if (mainnetBlockTime > this.configService.blockTimeThreshold) {
                this.logger.warn(
                  `Slow Mainnet block time detected! Time between blocks: ${mainnetBlockTime}s - Threshold: ${this.configService.blockTimeThreshold}s`,
                );
              }

              this.logger.debug(`Updated Mainnet block time metric: ${mainnetBlockTime}s for chainId 50`);
            }

            await this.processBlock(fullMainnetBlock, '50');
            this.logger.debug(`Processed Mainnet block #${highestMainnetBlock} transactions`);
          } catch (error) {
            this.logger.error(`Error processing Mainnet block #${highestMainnetBlock}: ${error.message}`);
          }

          this.lastHighestBlockMainnet = highestMainnetBlock;
        }
      }

      // Process Testnet block time separately
      if (testnetResults.length > 0) {
        const testnetBlockNumbers = testnetResults.map(r => r.blockNumber);
        const highestTestnetBlock = Math.max(...testnetBlockNumbers);

        if (highestTestnetBlock > this.lastHighestBlockTestnet) {
          this.logger.debug(
            `New Testnet block detected: #${highestTestnetBlock} (previous: #${this.lastHighestBlockTestnet})`,
          );

          try {
            const fullTestnetBlock = await this.blockchainService.getBlockByNumberForChain(highestTestnetBlock, 51);
            const previousTestnetBlock = await this.blockchainService.getBlockByNumberForChain(
              highestTestnetBlock - 1,
              51,
            );

            if (previousTestnetBlock) {
              const testnetBlockTime = fullTestnetBlock.timestamp - previousTestnetBlock.timestamp;
              this.metricsService.setBlockTime(testnetBlockTime, 51);

              this.logger.debug(`Testnet block time based on block timestamps: ${testnetBlockTime}s`);

              if (testnetBlockTime > this.configService.blockTimeThreshold) {
                this.logger.warn(
                  `Slow Testnet block time detected! Time between blocks: ${testnetBlockTime}s - Threshold: ${this.configService.blockTimeThreshold}s`,
                );
              }

              this.logger.debug(`Updated Testnet block time metric: ${testnetBlockTime}s for chainId 51`);
            }

            await this.processBlock(fullTestnetBlock, '51');
            this.logger.debug(`Processed Testnet block #${highestTestnetBlock} transactions`);
          } catch (error) {
            this.logger.error(`Error processing Testnet block #${highestTestnetBlock}: ${error.message}`);
          }

          this.lastHighestBlockTestnet = highestTestnetBlock;
        }
      }

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

  /**
   * Process a block from either Mainnet or Testnet
   */
  async processBlock(block: BlockInfo, chainId: string): Promise<void> {
    try {
      this.logger.debug(`Processing block #${block.number} (chainId: ${chainId})`);

      const parsedChainId = parseInt(chainId, 10);
      const chainName = parsedChainId === 50 ? 'Mainnet' : parsedChainId === 51 ? 'Testnet' : 'Unknown';

      let confirmedTxCount = 0;
      let failedTxCount = 0;

      if (block.transactions && block.transactions.length > 0) {
        try {
          for (let i = 0; i < block.transactions.length; i++) {
            const txHash = block.transactions[i];
            try {
              const tx = await this.blockchainService.getTransaction(txHash);

              if (tx) {
                if (tx.status === TransactionStatus.CONFIRMED) {
                  confirmedTxCount++;
                } else if (tx.status === TransactionStatus.FAILED) {
                  failedTxCount++;
                } else if (tx.status === TransactionStatus.PENDING) {
                }
              }
            } catch (txError) {
              this.logger.error(`Error processing transaction ${txHash}: ${txError.message}`);
            }
          }
        } catch (error) {
          this.logger.error(`Error processing transactions for block #${block.number}: ${error.message}`);
          confirmedTxCount = block.transactions.length;
        }
      }

      this.metricsService.setTransactionsPerBlock(
        block.number,
        block.transactions.length,
        confirmedTxCount,
        failedTxCount,
        chainId,
      );
      this.logger.debug(
        `Block #${block.number} on ${chainName} (chainId ${chainId}): ${confirmedTxCount} confirmed, ${failedTxCount} failed transactions`,
      );
    } catch (error) {
      this.logger.error(`Error processing block: ${error.message}`);
    }
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
