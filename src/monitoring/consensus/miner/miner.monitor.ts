import { AlertService } from '@alerts/alert.service';
import { ALERTS } from '@common/constants/config';
import { RpcRetryClient } from '@common/utils/rpc-retry-client';
import { ConfigService } from '@config/config.service';
import { MetricsService } from '@metrics/metrics.service';
import { ConsensusMonitor } from '@monitoring/consensus/consensus.monitor';
import {
  TIMEOUT_THRESHOLD,
  createRpcClient,
  fetchBlockBatch,
  getMissedRoundsForEpoch,
  getMonitoringConfig,
} from '@monitoring/consensus/consensus.utils';
import { Injectable, Logger, OnModuleDestroy, OnModuleInit, Inject, forwardRef } from '@nestjs/common';
import { ConsensusMonitoringInfo, ConsensusViolation, MinerPerformance } from '@types';
import { performance } from 'perf_hooks';

// Core data structures
interface MissedRound {
  round: number;
  miner: string;
  blockNumber: number;
}

interface ChainState {
  chainId: number;
  rpcClient: RpcRetryClient;
  lastCheckedBlock: number;
  lastBlockTimestamp: number;
  currentEpochBlock: number; // Block number where the current epoch started
  epochRound: number; // Starting round of the current epoch
  knownMissedRounds: MissedRound[]; // Rounds known to be missed in this epoch
  minerPerformance: Record<string, MinerPerformance>;
  recentViolations: ConsensusViolation[]; // Store recent timeout and consensus violation events for API access and dashboards
  lastMissedRoundsCheck: number; // Block number when we last checked for missed rounds
}

/**
 * Service for monitoring XDC blockchain miner consensus and timeouts
 */
@Injectable()
export class MinerMonitor implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(MinerMonitor.name);
  private readonly MAX_RECENT_VIOLATIONS = 100;

  private monitoringEnabled = false;
  private scanIntervalMs = 15000; // Default: 15 seconds
  private supportedChains: number[] = [50, 51]; // Default: mainnet and testnet
  private chainStates: Record<number, ChainState> = {};

  constructor(
    private readonly configService: ConfigService,
    private readonly metricsService: MetricsService,
    private readonly alertService: AlertService,
    @Inject(forwardRef(() => ConsensusMonitor))
    private readonly consensusMonitorService: ConsensusMonitor,
  ) {
    const { enabled, scanIntervalMs, chains } = getMonitoringConfig(this.configService);
    this.monitoringEnabled = enabled;
    this.scanIntervalMs = scanIntervalMs;
    this.supportedChains = chains;

    // Initialize chain states
    chains.forEach(chainId => {
      this.chainStates[chainId] = {
        chainId,
        rpcClient: createRpcClient(this.configService, chainId),
        lastCheckedBlock: 0,
        lastBlockTimestamp: 0,
        currentEpochBlock: 0,
        epochRound: 0,
        knownMissedRounds: [],
        minerPerformance: {},
        recentViolations: [],
        lastMissedRoundsCheck: 0,
      };
    });
  }

  /**
   * Initialize the monitor and register monitoring intervals for each chain
   */
  async onModuleInit() {
    if (!this.monitoringEnabled) {
      this.logger.log(`${MinerMonitor.name} is disabled`);
      return;
    }

    try {
      this.logger.log(`Initializing ${MinerMonitor.name}...`);

      // Load historical data from InfluxDB for each chain
      for (const chainId of this.supportedChains) {
        await this.loadHistoricalMinerData(chainId);
        this.consensusMonitorService.registerMonitoringInterval(
          `${MinerMonitor.name}-${chainId}`,
          () => this.monitorMiners(chainId),
          this.scanIntervalMs,
        );
        this.logger.log(`Monitoring enabled for chain ${chainId}`);
      }
    } catch (error) {
      this.logger.error(`Failed to initialize ${MinerMonitor.name}: ${error.message}`);
    }
  }

  /**
   * Cleanup on module destruction
   */
  onModuleDestroy() {
    this.supportedChains.forEach(chainId => {
      this.consensusMonitorService.deregisterMonitoringInterval(`${MinerMonitor.name}-${chainId}`);
    });
  }

  /**
   * Main monitoring logic for miners on a specific chain
   * Fetches latest blocks and processes miner performance metrics
   */
  private async monitorMiners(chainId: number): Promise<void> {
    const chainState = this.chainStates[chainId];
    const validatorData = this.consensusMonitorService.getValidatorData(chainId);

    if (!this.monitoringEnabled || !chainState || !validatorData?.masternodeList) return;

    try {
      const startTime = performance.now();
      const latestBlockResponse = await chainState.rpcClient.call('eth_getBlockByNumber', ['latest', false]);

      if (!latestBlockResponse?.result) {
        throw new Error(`Could not fetch latest block for chain ${chainId}`);
      }

      const latestBlockNumber = parseInt(latestBlockResponse.result.number, 16);
      if (latestBlockNumber <= chainState.lastCheckedBlock) return;

      // Check for missed rounds periodically
      if (chainState.lastMissedRoundsCheck === 0 || latestBlockNumber - chainState.lastMissedRoundsCheck >= 50) {
        await this.updateMissedRounds(chainId);
        chainState.lastMissedRoundsCheck = latestBlockNumber;
      }

      const startBlockNum = chainState.lastCheckedBlock + 1;
      const blockCount = latestBlockNumber - startBlockNum + 1;

      this.logger.log(
        `Chain ${chainId}: Processing ${blockCount} blocks from ${startBlockNum} to ${latestBlockNumber}`,
      );

      // Process blocks in batch
      const blocks = await fetchBlockBatch(
        chainState.rpcClient,
        startBlockNum,
        latestBlockNumber,
        Math.min(50, blockCount),
        true,
      );

      // Update miner performance for each block
      for (const block of blocks) {
        const blockNumber = parseInt(block.number, 16);
        const round = parseInt(block.round, 16);
        const miner = block.miner.toLowerCase();

        this.updateMinerPerformance(chainId, miner, blockNumber);

        const missedRound = chainState.knownMissedRounds.find(mr => mr.round === round);
        if (missedRound) {
          this.logger.debug(
            `Chain ${chainId}: Block ${blockNumber} - Known missed round ${round}: Original ${missedRound.miner}, actual ${miner}`,
          );
        }
      }

      // Update state and log performance
      chainState.lastCheckedBlock = latestBlockNumber;
      if (latestBlockResponse.result.timestamp) {
        chainState.lastBlockTimestamp = parseInt(latestBlockResponse.result.timestamp, 16);
      }

      this.logger.log(
        `Chain ${chainId}: Processed ${blocks.length} blocks in ${(performance.now() - startTime).toFixed(2)}ms`,
      );
    } catch (error) {
      this.logger.error(`Miner monitoring error for chain ${chainId}: ${error.message}`);
      this.metricsService.saveAlert({
        type: 'error',
        title: `Chain ${chainId} - Miner Monitoring Error`,
        message: error.message,
        timestamp: new Date(),
        component: 'consensus',
      });
    }
  }

  /**
   * Update missed rounds information from the blockchain API
   * Fetches the current set of missed rounds and processes any new ones
   */
  private async updateMissedRounds(chainId: number): Promise<void> {
    try {
      const chainState = this.chainStates[chainId];
      const missedRoundsData = await getMissedRoundsForEpoch(chainState.rpcClient);

      if (!missedRoundsData) return;

      // Update epoch data if changed
      if (chainState.currentEpochBlock !== missedRoundsData.EpochBlockNumber) {
        this.logger.log(`Chain ${chainId}: Updating epoch block ${missedRoundsData.EpochBlockNumber}`);
        chainState.currentEpochBlock = missedRoundsData.EpochBlockNumber;
      }

      chainState.epochRound = missedRoundsData.EpochRound;

      // Track new missed rounds
      const existingRounds = new Set(chainState.knownMissedRounds.map(mr => mr.round));
      chainState.knownMissedRounds = missedRoundsData.MissedRounds.map(mr => ({
        round: mr.Round,
        miner: mr.Miner.toLowerCase(),
        blockNumber: mr.CurrentBlockNum,
      }));

      // Process only new missed rounds
      const newMissedRounds = missedRoundsData.MissedRounds.filter(mr => !existingRounds.has(mr.Round));
      if (newMissedRounds.length > 0) {
        this.logger.log(`Chain ${chainId}: Found ${newMissedRounds.length} new missed rounds`);
        for (const missedRound of newMissedRounds) {
          await this.processMissedRound(chainId, missedRound);
        }
      }

      this.logger.log(
        `Chain ${chainId}: Updated missed rounds - epoch: ${chainState.currentEpochBlock}, ` +
          `round: ${chainState.epochRound}, count: ${chainState.knownMissedRounds.length}`,
      );
    } catch (error) {
      this.logger.error(`Chain ${chainId}: Failed to update missed rounds: ${error.message}`);
    }
  }

  /**
   * Process a missed round and calculate how many miners were skipped
   * Records metrics, creates violation records, and generates alerts if needed
   */
  private async processMissedRound(chainId: number, missedRound: any): Promise<void> {
    try {
      const chainState = this.chainStates[chainId];
      const blockNumber = missedRound.CurrentBlockNum;
      const round = missedRound.Round;
      const expectedMiner = missedRound.Miner.toLowerCase();

      // Fetch current and parent blocks
      const [currentBlock, prevBlock] = await Promise.all([
        this.fetchBlock(chainState.rpcClient, blockNumber),
        this.fetchBlock(chainState.rpcClient, missedRound.ParentBlockNum),
      ]);

      if (!currentBlock || !prevBlock) return;

      const actualMiner = currentBlock.miner.toLowerCase();
      const timeoutPeriod = parseInt(currentBlock.timestamp, 16) - parseInt(prevBlock.timestamp, 16);

      // Calculate missed miners count
      const validatorData = this.consensusMonitorService.getValidatorData(chainId);
      if (!validatorData?.masternodeList?.masternodes) {
        this.logger.warn(`Cannot determine missed miners - masternode list unavailable for chain ${chainId}`);
        return;
      }

      const masternodes = validatorData.masternodeList.masternodes.map(addr => addr.toLowerCase());
      const expectedMinerIndex = masternodes.indexOf(expectedMiner);
      const actualMinerIndex = masternodes.indexOf(actualMiner);

      let missedMiners = 0;
      if (expectedMinerIndex >= 0 && actualMinerIndex >= 0) {
        missedMiners =
          actualMinerIndex > expectedMinerIndex
            ? actualMinerIndex - expectedMinerIndex
            : masternodes.length - expectedMinerIndex + actualMinerIndex; // Wraparound case
      } else {
        missedMiners = Math.round(timeoutPeriod / TIMEOUT_THRESHOLD);
        this.logger.warn(
          `Unable to determine exact miners missed: Expected: ${expectedMiner} (${expectedMinerIndex}), ` +
            `Actual: ${actualMiner} (${actualMinerIndex}) - using estimate: ${missedMiners}`,
        );
      }

      // Record metrics and create violation
      this.metricsService.recordMissedRound(chainId, blockNumber, round, expectedMiner, actualMiner, missedMiners);
      this.metricsService.recordTimeoutPeriod(chainId, blockNumber, timeoutPeriod, TIMEOUT_THRESHOLD, missedMiners);

      const expectedTimeoutPeriod = missedMiners * TIMEOUT_THRESHOLD;
      const isConsistentTimeout = Math.abs(timeoutPeriod - expectedTimeoutPeriod) <= 2;

      this.recordViolation(chainId, {
        blockNumber,
        round,
        expectedMiner,
        actualMiner,
        violationType: 'timeout' as const,
        timestamp: new Date(),
        timeDifference: timeoutPeriod,
        estimatedMissedMiners: missedMiners,
      });

      this.logger.log(
        `Chain ${chainId} - Block ${blockNumber}: Timeout ${timeoutPeriod}s, ` +
          `missed miners: ${missedMiners} (${expectedMiner} → ${actualMiner})`,
      );

      // Alert on unusual timeouts or multiple missed miners
      if (!isConsistentTimeout || missedMiners >= 2) {
        const alertMessage = !isConsistentTimeout
          ? `Chain ${chainId} - Block ${blockNumber}: Unusual timeout of ${timeoutPeriod}s vs expected ${expectedTimeoutPeriod}s for ${missedMiners} missed miners.`
          : `Chain ${chainId} - Block ${blockNumber}: ${missedMiners} consecutive miners missed their turn.`;

        this.alertService.warning(
          ALERTS.TYPES.CONSENSUS_UNUSUAL_TIMEOUT,
          ALERTS.COMPONENTS.CONSENSUS,
          alertMessage,
          chainId,
        );
      }

      // Update miner's missed blocks count
      this.updateMinerMissedStats(chainId, expectedMiner);
    } catch (error) {
      this.logger.error(`Failed to process missed round for chain ${chainId}: ${error.message}`);
    }
  }

  /**
   * Fetches a block from the blockchain by number
   * Helper method to reduce code duplication
   */
  private async fetchBlock(rpcClient: RpcRetryClient, blockNumber: number): Promise<any> {
    const blockHex = `0x${blockNumber.toString(16)}`;
    const response = await rpcClient.call('eth_getBlockByNumber', [blockHex, false]);

    if (!response?.result) {
      this.logger.warn(`Failed to fetch block ${blockNumber}`);
      return null;
    }
    return response.result;
  }

  /**
   * Update miner missed round statistics and trigger alerts at thresholds
   * Called when a miner misses their turn to mine a block
   */
  private updateMinerMissedStats(chainId: number, address: string): void {
    const chainState = this.chainStates[chainId];
    address = address.toLowerCase();

    // Initialize if not exists
    if (!chainState.minerPerformance[address]) {
      chainState.minerPerformance[address] = {
        address,
        totalBlocksMined: 0,
        missedBlocks: 0,
        lastActiveBlock: 0,
        lastActive: new Date(),
      };
    }

    const minerStats = chainState.minerPerformance[address];
    minerStats.missedBlocks++;

    // Record metrics
    this.metricsService.recordMinerMissedRound(chainId, address, minerStats.missedBlocks);
    this.metricsService.recordMinerPerformance(
      chainId,
      address,
      minerStats.totalBlocksMined,
      minerStats.missedBlocks,
      chainState.lastCheckedBlock,
    );

    // Alert at significant thresholds
    if (minerStats.missedBlocks % 10 === 0) {
      this.alertService.warning(
        ALERTS.TYPES.CONSENSUS_FREQUENT_MISSED_ROUNDS,
        ALERTS.COMPONENTS.CONSENSUS,
        `Chain ${chainId} - Miner ${address} has missed ${minerStats.missedBlocks} mining rounds`,
        chainId,
      );
    }
  }

  /**
   * Record a consensus violation for a specific chain
   * Stores the violation in a bounded collection for API access and dashboard display
   */
  private recordViolation(chainId: number, violation: ConsensusViolation): void {
    const chainState = this.chainStates[chainId];
    chainState.recentViolations.unshift(violation);

    // Limit collection size
    if (chainState.recentViolations.length > this.MAX_RECENT_VIOLATIONS) {
      chainState.recentViolations.pop();
    }
  }

  /**
   * Update miner performance when they successfully mine a block
   * Updates metrics and records the miner's activity
   */
  private updateMinerPerformance(chainId: number, address: string, blockNumber: number): void {
    const chainState = this.chainStates[chainId];
    address = address.toLowerCase();

    // Initialize if not exists
    if (!chainState.minerPerformance[address]) {
      chainState.minerPerformance[address] = {
        address,
        totalBlocksMined: 0,
        missedBlocks: 0,
        lastActiveBlock: blockNumber,
        lastActive: new Date(),
      };
    }

    // Update performance metrics
    const minerStats = chainState.minerPerformance[address];
    minerStats.totalBlocksMined++;
    minerStats.lastActiveBlock = blockNumber;
    minerStats.lastActive = new Date();

    this.metricsService.recordMinerPerformance(
      chainId,
      address,
      minerStats.totalBlocksMined,
      minerStats.missedBlocks,
      blockNumber,
    );
  }

  /**
   * Get miner monitoring info for a specific chain or all chains
   * Provides data for API endpoints and dashboards
   */
  public getMinerMonitoringInfo(chainId?: number): ConsensusMonitoringInfo | Record<number, ConsensusMonitoringInfo> {
    if (chainId && this.chainStates[chainId]) {
      return this.getChainMonitoringInfo(chainId);
    }

    const result: Record<number, ConsensusMonitoringInfo> = {};
    for (const chainId of this.supportedChains) {
      result[chainId] = this.getChainMonitoringInfo(chainId);
    }
    return result;
  }

  /**
   * Get monitoring information for a specific chain
   * Collects data from various sources into a single structure
   */
  private getChainMonitoringInfo(chainId: number): ConsensusMonitoringInfo {
    const chainState = this.chainStates[chainId];
    const validatorData = this.consensusMonitorService.getValidatorData(chainId);

    return {
      isEnabled: this.monitoringEnabled,
      chainId,
      lastCheckedBlock: chainState.lastCheckedBlock,
      currentEpoch: validatorData?.currentEpoch || 0,
      nextEpochBlock: validatorData?.nextEpochBlock || 0,
      currentEpochBlock: chainState.currentEpochBlock,
      masternodeCount: validatorData?.masternodeList?.masternodes.length || 0,
      standbyNodeCount: validatorData?.masternodeList?.standbynodes.length || 0,
      penaltyNodeCount: validatorData?.masternodeList?.penalty.length || 0,
      recentViolations: chainState.recentViolations.slice(0, 10),
      minerPerformance: chainState.minerPerformance,
    };
  }

  /**
   * Get miner performance metrics for a specific chain
   * Returns the performance data for all miners on the specified chain
   */
  public getMinerPerformance(chainId: number): Record<string, MinerPerformance> {
    return this.chainStates[chainId]?.minerPerformance || {};
  }

  /**
   * Get recent consensus violations for API and dashboard display
   * Returns the 10 most recent violations for the specified chain
   */
  public getRecentViolations(chainId: number): ConsensusViolation[] {
    return this.chainStates[chainId]?.recentViolations.slice(0, 10) || [];
  }

  /**
   * Load historical miner performance data from InfluxDB
   * Initializes miner performance tracking with historical data
   */
  private async loadHistoricalMinerData(chainId: number): Promise<void> {
    try {
      const chainState = this.chainStates[chainId];
      this.logger.log(`Loading historical miner data for chain ${chainId}...`);

      // Get latest block and set checkpoint
      const latestBlockResponse = await chainState.rpcClient.call('eth_getBlockByNumber', ['latest', false]);
      if (!latestBlockResponse?.result) {
        this.logger.warn(`Could not fetch latest block for chain ${chainId}`);
        return;
      }

      const latestBlockNumber = parseInt(latestBlockResponse.result.number, 16);
      chainState.lastCheckedBlock = latestBlockNumber - 100; // Start checking from 100 blocks back

      // Get validators and their performance data
      const validatorData = this.consensusMonitorService.getValidatorData(chainId);
      if (!validatorData?.masternodeList?.masternodes) {
        this.logger.warn(`Could not load masternode list for chain ${chainId}`);
        return;
      }

      const minerAddresses = validatorData.masternodeList.masternodes.map(addr => addr.toLowerCase());
      const performanceData = await this.metricsService.getMinerPerformanceData(chainId, minerAddresses);

      // Initialize performance data for each miner
      for (const miner of minerAddresses) {
        const minerData = performanceData[miner] || {
          totalBlocksMined: 0,
          missedBlocks: 0,
          lastActiveBlock: 0,
          lastActive: null,
        };

        chainState.minerPerformance[miner] = {
          address: miner,
          totalBlocksMined: minerData.totalBlocksMined,
          missedBlocks: minerData.missedBlocks,
          lastActiveBlock: minerData.lastActiveBlock,
          lastActive: minerData.lastActive ? new Date(minerData.lastActive) : new Date(),
        };
      }

      this.logger.log(`Loaded data for ${Object.keys(chainState.minerPerformance).length} miners on chain ${chainId}`);
    } catch (error) {
      this.logger.error(`Failed to load historical data for chain ${chainId}: ${error.message}`);
      this.logger.log('Continuing with empty performance data...');
    }
  }
}
