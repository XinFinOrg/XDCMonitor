import { ConfigService } from '@config/config.service';
import { MetricsService } from '@metrics/metrics.service';
import { Injectable, Logger, OnModuleDestroy, OnModuleInit, Inject, forwardRef } from '@nestjs/common';
import { SchedulerRegistry } from '@nestjs/schedule';
import { ConsensusMonitoringInfo, MasternodeList } from '@types';
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
  private validatorRefreshInterval = 60000;

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
    // await this.initializeEpochMonitoring();
    // await this.initializeRewardMonitoring();
  }

  onModuleDestroy() {
    // Clean up all intervals
    for (const chainId of this.supportedChains) {
      this.deregisterMonitoringInterval(`ValidatorRefresh-${chainId}`);
      this.deregisterMonitoringInterval(`${MinerMonitor.name}-${chainId}`);
      // this.deregisterMonitoringInterval(`${EpochMonitor.name}-${chainId}`);
      // this.deregisterMonitoringInterval(`${RewardMonitor.name}-${chainId}`);
    }
    this.logger.log('All monitoring intervals deregistered');
  }

  /**
   * Refresh validator data for a specific chain and store it
   */
  private async refreshValidatorData(chainId: number): Promise<void> {
    try {
      const rpcClient = createRpcClient(this.configService, chainId);
      const result = await this.fetchMasternodeList(`ConsensusMonitor-${chainId}`, rpcClient);

      if (!result) return;

      // Update the in-memory cache
      this.chainValidatorData[chainId] = {
        ...result,
        lastUpdated: new Date(),
      };

      // Store the complete validator data in InfluxDB
      this.storeValidatorData(chainId, result);

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
   * Store validator data in InfluxDB
   * This provides historical tracking of validator node changes over time
   */
  private storeValidatorData(chainId: number, data: { masternodeList: MasternodeList; currentEpoch: number }): void {
    try {
      const { masternodeList, currentEpoch } = data;

      // Store summary metrics
      this.metricsService.recordValidatorSummary(
        chainId,
        currentEpoch,
        masternodeList.masternodes.length,
        masternodeList.standbynodes.length,
        masternodeList.penalty.length,
        masternodeList.number,
        masternodeList.round,
      );

      // Store each node address in its own record
      masternodeList.masternodes.forEach((address, index) => {
        this.metricsService.recordValidatorDetail(chainId, currentEpoch, address.toLowerCase(), 'masternode', index);
      });

      masternodeList.standbynodes.forEach((address, index) => {
        this.metricsService.recordValidatorDetail(chainId, currentEpoch, address.toLowerCase(), 'standby', index);
      });

      masternodeList.penalty.forEach(address => {
        this.metricsService.recordValidatorDetail(chainId, currentEpoch, address.toLowerCase(), 'penalty');
      });
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
   */
  public isNodePenalized(chainId: number, address: string): boolean {
    if (!this.chainValidatorData[chainId]?.masternodeList?.penalty) return false;

    address = address.toLowerCase();
    return this.chainValidatorData[chainId].masternodeList.penalty.map(a => a.toLowerCase()).includes(address);
  }

  /**
   * Get node status (masternode, standby, penalty, or none)
   */
  public getNodeStatus(chainId: number, address: string): 'masternode' | 'standby' | 'penalty' | 'none' {
    if (!this.chainValidatorData[chainId]?.masternodeList) return 'none';

    address = address.toLowerCase();
    const { masternodes, standbynodes, penalty } = this.chainValidatorData[chainId].masternodeList;

    if (masternodes.map(a => a.toLowerCase()).includes(address)) return 'masternode';
    if (standbynodes.map(a => a.toLowerCase()).includes(address)) return 'standby';
    if (penalty.map(a => a.toLowerCase()).includes(address)) return 'penalty';

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
   * Get supported chains for consensus monitoring
   */
  public getSupportedChains(): number[] {
    return this.supportedChains;
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
}
