import { ConfigService } from '@config/config.service';
import { MetricsService } from '@metrics/metrics.service';
import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { SchedulerRegistry } from '@nestjs/schedule';
import { ConsensusMonitoringInfo, MasternodeList } from '@types';
import { createRpcClient, getNextEpochBlock } from './consensus.utils';
import { EpochMonitor } from './epoch/epoch.monitor';
import { MinerMonitor } from './miner/miner.monitor';
import { RewardMonitor } from './reward/reward.monitor';

// Interface for cached validator data
interface ChainValidatorData {
  masternodeList: MasternodeList;
  currentEpoch: number;
  nextEpochBlock: number;
  lastUpdated: Date;
}

/**
 * Main service for coordinating XDC blockchain consensus monitoring
 *
 * This service coordinates the three specialized monitors:
 * - MinerMonitor: Tracks miner order and timeouts
 * - EpochMonitor: Tracks epoch transitions and masternode list changes
 * - RewardMonitor: Tracks reward distribution at epoch boundaries
 */
@Injectable()
export class ConsensusMonitorService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ConsensusMonitorService.name);
  private intervalRegistry: Record<string, string> = {};
  private supportedChains: number[] = [50, 51]; // Default: mainnet and testnet

  // Cached validator data for each chain
  private chainValidatorData: Record<number, ChainValidatorData> = {};

  // Refresh interval in ms (default: 60 seconds)
  private validatorRefreshInterval = 60000;

  constructor(
    private readonly minerMonitor: MinerMonitor,
    private readonly epochMonitor: EpochMonitor,
    private readonly rewardMonitor: RewardMonitor,
    private readonly configService: ConfigService,
    private readonly schedulerRegistry: SchedulerRegistry,
    private readonly metricsService: MetricsService,
  ) {
    this.supportedChains = this.configService.getNumberArray('consensusMonitoringChains', [50, 51]);
    this.validatorRefreshInterval = this.configService.get('masternodeRefreshInterval', 60000);
    this.logger.log(`Consensus monitoring service initialized for chains: ${this.supportedChains.join(', ')}`);
  }

  async onModuleInit() {
    // Initialize validator data for each chain
    for (const chainId of this.supportedChains) {
      // Create initial empty data structure
      this.chainValidatorData[chainId] = {
        masternodeList: null,
        currentEpoch: 0,
        nextEpochBlock: 0,
        lastUpdated: null,
      };

      // Do initial fetch for each chain
      await this.refreshValidatorData(chainId);

      // Set up periodic refresh
      this.registerMonitoringInterval(
        `ValidatorRefresh-${chainId}`,
        () => this.refreshValidatorData(chainId),
        this.validatorRefreshInterval,
      );
    }
  }

  onModuleDestroy() {
    // Clean up all intervals
    for (const chainId of this.supportedChains) {
      this.deregisterMonitoringInterval(`ValidatorRefresh-${chainId}`);
    }
  }

  /**
   * Refresh validator data for a specific chain and store it
   */
  private async refreshValidatorData(chainId: number): Promise<void> {
    try {
      const rpcClient = createRpcClient(this.configService, chainId);
      const result = await this.fetchMasternodeList(`ConsensusMonitorService-${chainId}`, rpcClient);

      if (result) {
        // Update the in-memory cache
        this.chainValidatorData[chainId] = {
          ...result,
          lastUpdated: new Date(),
        };

        // Store the complete validator data in InfluxDB
        this.storeValidatorData(chainId, result);

        this.logger.log(
          `Validator data refreshed for chain ${chainId}: epoch=${result.currentEpoch}, ` +
            `masternodes=${result.masternodeList.masternodes.length}, ` +
            `standbynodes=${result.masternodeList.standbynodes.length}, ` +
            `penalty=${result.masternodeList.penalty.length}`,
        );
      }
    } catch (error) {
      this.logger.error(`Failed to refresh validator data for chain ${chainId}: ${error.message}`);
    }
  }

  /**
   * Store validator data in InfluxDB
   * This provides historical tracking of validator node changes over time
   */
  private storeValidatorData(
    chainId: number,
    data: { masternodeList: MasternodeList; currentEpoch: number; nextEpochBlock: number },
  ): void {
    try {
      const { masternodeList, currentEpoch } = data;
      const timestamp = new Date();

      // Store summary metrics using the new public method
      this.metricsService.recordValidatorSummary(
        chainId,
        currentEpoch,
        masternodeList.masternodes.length,
        masternodeList.standbynodes.length,
        masternodeList.penalty.length,
        masternodeList.number,
        masternodeList.round,
      );

      // Store each masternode address in its own record
      masternodeList.masternodes.forEach((address, index) => {
        this.metricsService.recordValidatorDetail(chainId, currentEpoch, address.toLowerCase(), 'masternode', index);
      });

      // Store standby nodes
      masternodeList.standbynodes.forEach((address, index) => {
        this.metricsService.recordValidatorDetail(chainId, currentEpoch, address.toLowerCase(), 'standby', index);
      });

      // Store penalty nodes
      masternodeList.penalty.forEach(address => {
        this.metricsService.recordValidatorDetail(chainId, currentEpoch, address.toLowerCase(), 'penalty');
      });

      // Log summary for tracking
      const infoAlert = {
        type: 'info' as const,
        title: `Chain ${chainId} - Validator Data Stored`,
        message: `Epoch ${currentEpoch}: Stored ${masternodeList.masternodes.length} masternodes, ${masternodeList.standbynodes.length} standbynodes, ${masternodeList.penalty.length} penalty nodes`,
        timestamp,
        component: 'consensus',
      };
      this.metricsService.saveAlert(infoAlert);
    } catch (error) {
      this.logger.error(`Failed to store validator data in InfluxDB: ${error.message}`);
    }
  }

  /**
   * Get cached validator data for a specific chain
   * This is the method monitors should call instead of fetching directly
   */
  public getValidatorData(chainId: number): ChainValidatorData {
    return this.chainValidatorData[chainId];
  }

  /**
   * Check if a node address is in the penalty list
   * This is useful for other monitors to check
   */
  public isNodePenalized(chainId: number, address: string): boolean {
    if (!this.chainValidatorData[chainId]?.masternodeList?.penalty) {
      return false;
    }

    address = address.toLowerCase();
    return this.chainValidatorData[chainId].masternodeList.penalty.map(a => a.toLowerCase()).includes(address);
  }

  /**
   * Get node status (masternode, standby, penalty, or none)
   */
  public getNodeStatus(chainId: number, address: string): 'masternode' | 'standby' | 'penalty' | 'none' {
    if (!this.chainValidatorData[chainId]?.masternodeList) {
      return 'none';
    }

    address = address.toLowerCase();
    const { masternodes, standbynodes, penalty } = this.chainValidatorData[chainId].masternodeList;

    if (masternodes.map(a => a.toLowerCase()).includes(address)) {
      return 'masternode';
    }

    if (standbynodes.map(a => a.toLowerCase()).includes(address)) {
      return 'standby';
    }

    if (penalty.map(a => a.toLowerCase()).includes(address)) {
      return 'penalty';
    }

    return 'none';
  }

  /**
   * Get comprehensive consensus monitoring information for specific chain or all chains
   */
  public getConsensusMonitoringInfo(
    chainId?: number,
  ): ConsensusMonitoringInfo | Record<number, ConsensusMonitoringInfo> {
    // Return monitoring info for specific chain or all chains
    return this.minerMonitor.getMinerMonitoringInfo(chainId);
  }

  /**
   * Helper method to register a monitoring interval
   * This can be used by the individual monitors instead of managing their own intervals
   */
  public registerMonitoringInterval(name: string, callback: () => Promise<void>, intervalMs: number): void {
    try {
      const intervalName = `${name.toLowerCase()}Monitoring`;

      // Clean up existing interval if it exists
      if (this.schedulerRegistry.doesExist('interval', intervalName)) {
        this.schedulerRegistry.deleteInterval(intervalName);
      }

      // Create new interval
      const interval = setInterval(callback, intervalMs);
      this.schedulerRegistry.addInterval(intervalName, interval);
      this.intervalRegistry[name] = intervalName;

      this.logger.log(`Registered monitoring interval for ${name} with ${intervalMs}ms interval`);
    } catch (error) {
      this.logger.error(`Failed to register monitoring interval for ${name}: ${error.message}`);
    }
  }

  /**
   * Helper method to deregister a monitoring interval
   */
  public deregisterMonitoringInterval(name: string): void {
    try {
      const intervalName = this.intervalRegistry[name] || `${name.toLowerCase()}Monitoring`;

      if (this.schedulerRegistry.doesExist('interval', intervalName)) {
        this.schedulerRegistry.deleteInterval(intervalName);
        this.logger.log(`Deregistered monitoring interval for ${name}`);
      }
    } catch (error) {
      this.logger.error(`Failed to deregister monitoring interval for ${name}: ${error.message}`);
    }
  }

  /**
   * Helper to retrieve masternode list - could be shared across monitors
   */
  public async fetchMasternodeList(
    component: string,
    rpcClient: any,
  ): Promise<{ masternodeList: MasternodeList; currentEpoch: number; nextEpochBlock: number } | null> {
    try {
      const response = await rpcClient.call('XDPoS_getMasternodesByNumber', ['latest']);

      if (!response || !response.result) {
        return null;
      }

      const result = response.result;

      // Calculate the current epoch number differently
      // The Number in the response is the current block height
      const currentBlockNumber = result.Number;

      // Find the current epoch by checking back a reasonable number of blocks
      // to find the previous epoch boundary
      const lookBackBlock = Math.max(0, currentBlockNumber - 1500);
      const hexCurrentBlock = `0x${currentBlockNumber.toString(16)}`;
      const hexLookBackBlock = `0x${lookBackBlock.toString(16)}`;

      let currentEpoch = 0;
      try {
        const epochResponse = await rpcClient.call('XDPoS_getEpochNumbersBetween', [hexLookBackBlock, hexCurrentBlock]);

        if (
          epochResponse &&
          epochResponse.result &&
          Array.isArray(epochResponse.result) &&
          epochResponse.result.length > 0
        ) {
          // Get the most recent epoch boundary
          const epochBoundaries = epochResponse.result;
          const mostRecentEpochBoundary = epochBoundaries[epochBoundaries.length - 1];

          // Calculate how many "epoch transitions" we've had
          // This is not a perfect calculation but gives us an approximate epoch number
          currentEpoch = Math.floor(mostRecentEpochBoundary / 900);
        } else {
          // Fallback to approximate calculation if we can't determine precisely
          currentEpoch = Math.floor(currentBlockNumber / 900);
        }
      } catch (error) {
        // Fallback to approximate calculation on error
        this.logger.error(`Failed to determine current epoch for ${component}: ${error.message}`);
        currentEpoch = Math.floor(currentBlockNumber / 900);
      }

      // Get the next epoch block
      let nextEpochBlock = currentBlockNumber + 900; // Default fallback
      try {
        // Look ahead to find the next epoch boundary
        const nextEpochNumber = await getNextEpochBlock(currentBlockNumber, rpcClient);
        if (nextEpochNumber > 0) nextEpochBlock = nextEpochNumber;
      } catch (error) {
        this.logger.error(`Failed to determine next epoch block for ${component}: ${error.message}`);
      }

      return {
        masternodeList: {
          number: result.Number,
          round: result.Round,
          masternodes: result.Masternodes,
          penalty: result.Penalty,
          standbynodes: result.Standbynodes,
        },
        currentEpoch,
        nextEpochBlock,
      };
    } catch (error) {
      this.logger.error(`Failed to fetch masternode list for ${component}: ${error.message}`);
      return null;
    }
  }

  /**
   * Get supported chains for consensus monitoring
   */
  public getSupportedChains(): number[] {
    return this.supportedChains;
  }
}
