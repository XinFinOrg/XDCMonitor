import { ConfigService } from '@config/config.service';
import { MetricsService } from '@metrics/metrics.service';
import { Injectable, Logger, OnModuleDestroy, OnModuleInit, Inject, forwardRef } from '@nestjs/common';
import { SchedulerRegistry } from '@nestjs/schedule';
import { ConsensusMonitoringInfo, MasternodeList, MinerStatus } from '@types';
import { createRpcClient, getNextEpochBlock } from './consensus.utils';
import { EpochMonitor } from './epoch/epoch.monitor';
import { MinerMonitor } from './miner/miner.monitor';
import { RewardMonitor } from './reward/reward.monitor';
import { ENV_VARS } from '@common/constants/config';

// Cached validator data interface
interface ChainValidatorData {
  masternodeList: MasternodeList;
  currentEpoch: number;
  lastUpdated: Date;
}

/**
 * Main service for coordinating XDC blockchain consensus monitoring
 * Orchestrates MinerMonitor, EpochMonitor, and RewardMonitor
 */
@Injectable()
export class ConsensusMonitor implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ConsensusMonitor.name);
  private intervalRegistry: Record<string, string> = {};
  private supportedChains: number[];
  private chainValidatorData: Record<number, ChainValidatorData> = {};
  private validatorRefreshInterval = 60000; // 1 minute

  constructor(
    @Inject(forwardRef(() => MinerMonitor)) private readonly minerMonitor: MinerMonitor,
    @Inject(forwardRef(() => EpochMonitor)) private readonly epochMonitor: EpochMonitor,
    @Inject(forwardRef(() => RewardMonitor)) private readonly rewardMonitor: RewardMonitor,
    private readonly configService: ConfigService,
    private readonly schedulerRegistry: SchedulerRegistry,
    private readonly metricsService: MetricsService,
  ) {
    this.supportedChains = this.configService.getNumberArray(ENV_VARS.CONSENSUS_MONITORING_CHAIN_IDS, [50, 51]);
    this.logger.log(`Consensus monitoring service initialized for chains: ${this.supportedChains.join(', ')}`);
  }

  async onModuleInit() {
    // Initialize validator data for each chain
    for (const chainId of this.supportedChains) {
      this.chainValidatorData[chainId] = {
        masternodeList: null,
        currentEpoch: 0,
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

    // Now that validator data is loaded, initialize component monitors
    this.logger.log('Validator data loaded for all chains, initializing component monitors...');
    await this.initializeMinerMonitoring();
    await this.initializeEpochMonitoring();
    // await this.initializeRewardMonitoring();
  }

  onModuleDestroy() {
    // Clean up all intervals
    for (const chainId of this.supportedChains) {
      this.deregisterMonitoringInterval(`ValidatorRefresh-${chainId}`);
      this.deregisterMonitoringInterval(`${MinerMonitor.name}-${chainId}`);
      this.deregisterMonitoringInterval(`${EpochMonitor.name}-${chainId}`);
      // this.deregisterMonitoringInterval(`${RewardMonitor.name}-${chainId}`);
    }
    this.logger.log('All monitoring intervals deregistered');
  }

  /**
   * Get supported chains for consensus monitoring
   */
  public getSupportedChains(): number[] {
    return this.supportedChains;
  }

  /**
   * Get cached validator data for a specific chain
   * This is the method monitors should call instead of fetching directly
   */
  public getValidatorData(chainId: number): ChainValidatorData {
    return this.chainValidatorData[chainId];
  }

  /**
   * Refresh validator data for a specific chain and store it
   */
  private async refreshValidatorData(chainId: number): Promise<void> {
    try {
      const rpcClient = createRpcClient(this.configService, chainId);
      const result = await this.fetchMasternodeList(`ConsensusMonitor-${chainId}`, rpcClient);

      if (!result) return;

      const oldEpoch = this.chainValidatorData[chainId]?.currentEpoch || 0;

      // Update the in-memory cache
      this.chainValidatorData[chainId] = {
        ...result,
        lastUpdated: new Date(),
      };

      // Only store data and update penalty tracking when the epoch changes
      if (result.currentEpoch > oldEpoch) {
        this.storeValidatorData(chainId, result);

        // Log the epoch transition
        this.logger.log(`Epoch transition detected for chain ${chainId}: ${oldEpoch} -> ${result.currentEpoch}`);
      }

      const { masternodeList, currentEpoch } = result;
      this.logger.log(
        `Validator data refreshed for chain ${chainId}: epoch=${currentEpoch}, ` +
          `masternodes=${masternodeList.masternodes.length}, ` +
          `standbynodes=${masternodeList.standbynodes.length}, ` +
          `penalty=${masternodeList.penalty.length}`,
      );
    } catch (error) {
      this.logger.error(`Failed to refresh validator data for chain ${chainId}: ${error.message}`);
    }
  }

  /**
   * Store validator data in InfluxDB for historical tracking
   */
  private storeValidatorData(chainId: number, data: { masternodeList: MasternodeList; currentEpoch: number }): void {
    try {
      const { masternodeList, currentEpoch } = data;
      const { number: blockNumber, round } = masternodeList;

      // Store summary metrics
      this.metricsService.recordValidatorSummary(
        chainId,
        currentEpoch,
        masternodeList.masternodes.length,
        masternodeList.standbynodes.length,
        masternodeList.penalty.length,
        blockNumber,
        round,
      );

      // Record metrics for each node type
      const recordNode = (address: string, status: MinerStatus, index?: number) => {
        this.metricsService.recordValidatorDetail(
          chainId,
          currentEpoch,
          blockNumber,
          round,
          address.toLowerCase(),
          status,
          index,
        );
      };

      // Process all node types
      masternodeList.masternodes.forEach((address, index) => recordNode(address, MinerStatus.Masternode, index));
      masternodeList.standbynodes.forEach((address, index) => recordNode(address, MinerStatus.Standby, index));
      masternodeList.penalty.forEach(address => recordNode(address, MinerStatus.Penalty));

      // Update penalty data in EpochMonitor
      this.epochMonitor.updatePenaltyData(chainId, masternodeList.penalty, currentEpoch);
    } catch (error) {
      this.logger.error(`Failed to store validator data in InfluxDB: ${error.message}`);
    }
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
   * Register a monitoring interval
   */
  public registerMonitoringInterval(name: string, callback: () => Promise<void> | void, intervalMs: number): void {
    try {
      const intervalName = `${name.toLowerCase()}Monitoring`;

      // Clean up existing interval if it exists
      if (this.schedulerRegistry.doesExist('interval', intervalName)) {
        this.schedulerRegistry.deleteInterval(intervalName);
      }

      // Execute immediately first
      this.executeMonitoringCallback(name, callback);

      // Create new interval
      const interval = setInterval(() => this.executeMonitoringCallback(name, callback), intervalMs);
      this.schedulerRegistry.addInterval(intervalName, interval);
      this.intervalRegistry[name] = intervalName;

      this.logger.log(`Registered monitoring interval for ${name} with ${intervalMs}ms interval`);
    } catch (error) {
      this.logger.error(`Failed to register monitoring interval for ${name}: ${error.message}`);
    }
  }

  /**
   * Execute a monitoring callback safely handling both Promise and non-Promise returns
   */
  private executeMonitoringCallback(name: string, callback: () => Promise<void> | void): void {
    try {
      const result = callback();
      if (result instanceof Promise) {
        result.catch(error => {
          this.logger.error(`Error in monitoring interval ${name}: ${error.message}`);
        });
      }
    } catch (error) {
      this.logger.error(`Error in monitoring interval ${name}: ${error.message}`);
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
  ): Promise<{ masternodeList: MasternodeList; currentEpoch: number } | null> {
    try {
      const response = await rpcClient.call('XDPoS_getMasternodesByNumber', ['latest']);

      if (!response) return null;

      /**
       * epochNum := x.config.V2.SwitchEpoch + uint64(epochSwitchInfo.EpochSwitchBlockInfo.Round)/x.config.Epoch
       * - SwitchEpoch:       common.MaintnetConstant.TIPV2SwitchBlock.Uint64() / 900,
       * - TIPV2SwitchBlock:  big.NewInt(80370000), // Target 2nd Oct 2024
       * - x.config.Epoch:    900
       */
      let currentEpoch = Math.floor(80370000 / 900) + Math.floor(response.Round / 900);

      return {
        masternodeList: {
          number: response.Number,
          round: response.Round,
          masternodes: response.Masternodes,
          penalty: response.Penalty,
          standbynodes: response.Standbynodes,
        },
        currentEpoch,
      };
    } catch (error) {
      this.logger.error(`Failed to fetch masternode list for ${component}: ${error.message}`);
      return null;
    }
  }

  /**
   * Initialize miner monitoring after validator data is loaded
   */
  private async initializeMinerMonitoring() {
    try {
      for (const chainId of this.supportedChains) {
        await this.minerMonitor.loadHistoricalMinerData(chainId);
        this.registerMonitoringInterval(
          `${MinerMonitor.name}-${chainId}`,
          () => this.minerMonitor.monitorMiners(chainId),
          this.minerMonitor.getScanIntervalMs(),
        );
        this.logger.log(`Miner monitoring enabled for chain ${chainId}`);
      }
    } catch (error) {
      this.logger.error(`Failed to initialize miner monitoring: ${error.message}`);
    }
  }

  /**
   * Initialize epoch monitoring after validator data is loaded
   */
  private async initializeEpochMonitoring() {
    try {
      // Register monitoring intervals for each chain
      for (const chainId of this.supportedChains) {
        // Register the monitoring interval
        this.registerMonitoringInterval(
          `${EpochMonitor.name}-${chainId}`,
          () => this.epochMonitor.monitorEpochPenalties(chainId),
          this.epochMonitor.getScanIntervalMs(),
        );
        this.logger.log(`Epoch monitoring enabled for chain ${chainId}`);
      }
    } catch (error) {
      this.logger.error(`Failed to initialize epoch monitoring: ${error.message}`);
    }
  }
}
