import { AlertService } from '@alerts/alert.service';
import { BlockchainService } from '@blockchain/blockchain.service';
import { ALERTS } from '@common/constants/config';
import { RpcRetryClient } from '@common/utils/rpc-retry-client';
import { ConfigService } from '@config/config.service';
import { MetricsService } from '@metrics/metrics.service';
import { BlocksMonitorService } from '@monitoring/blocks/blocks.monitor';
import { ConsensusMonitor } from '@monitoring/consensus/consensus.monitor';
import {
  TIMEOUT_THRESHOLD,
  createRpcClient,
  fetchBlockBatch,
  getMissedRoundsForEpoch,
  getMonitoringConfig,
} from '@monitoring/consensus/consensus.utils';
import { RpcMonitorService } from '@monitoring/rpc/rpc.monitor';
import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { SchedulerRegistry } from '@nestjs/schedule';
import { ConsensusMonitoringInfo, ConsensusViolation, MinerPerformance } from '@types';
import { performance } from 'perf_hooks';

// Interface for missed round tracking
interface MissedRound {
  round: number;
  miner: string;
  blockNumber: number;
}

// Chain-specific state interface
interface ChainState {
  chainId: number;
  rpcClient: RpcRetryClient;
  lastCheckedBlock: number;
  lastBlockTimestamp: number;
  currentEpochBlock: number; // Block number where the current epoch started
  epochRound: number; // Starting round of the current epoch
  knownMissedRounds: MissedRound[]; // Rounds known to be missed in this epoch
  minerPerformance: Record<string, MinerPerformance>;
  // Store recent timeout and consensus violation events for API access and dashboards
  recentViolations: ConsensusViolation[];
  lastMissedRoundsCheck: number; // Block number when we last checked for missed rounds
}

/**
 * Service for monitoring XDC blockchain miner consensus and timeouts
 */
@Injectable()
export class MinerMonitor implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(MinerMonitor.name);

  // Configuration
  private monitoringEnabled = false;
  private scanIntervalMs = 15000; // Default: 15 seconds
  private supportedChains: number[] = [50, 51]; // Default: mainnet and testnet

  // Chain-specific state tracking
  private chainStates: Record<number, ChainState> = {};

  // Constants
  private readonly MAX_RECENT_VIOLATIONS = 100;

  constructor(
    private readonly blockchainService: BlockchainService,
    private readonly configService: ConfigService,
    private readonly blocksMonitorService: BlocksMonitorService,
    private readonly rpcMonitorService: RpcMonitorService,
    private readonly metricsService: MetricsService,
    private readonly alertService: AlertService,
    private readonly schedulerRegistry: SchedulerRegistry,
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

  async onModuleInit() {
    if (!this.monitoringEnabled) {
      this.logger.log(`${MinerMonitor.name} is disabled`);
      return;
    }

    try {
      this.logger.log(`Initializing ${MinerMonitor.name}...`);

      for (const chainId of this.supportedChains) {
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

  onModuleDestroy() {
    // Cleanup on module destroy
    this.supportedChains.forEach(chainId => {
      this.consensusMonitorService.deregisterMonitoringInterval(`${MinerMonitor.name}-${chainId}`);
    });
  }

  /**
   * Main monitoring logic for miners on a specific chain
   */
  private async monitorMiners(chainId: number): Promise<void> {
    const chainState = this.chainStates[chainId];
    const validatorData = this.consensusMonitorService.getValidatorData(chainId);

    if (!this.monitoringEnabled || !chainState || !validatorData?.masternodeList) {
      return;
    }

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

      // Fetch and process blocks in batch
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

        const isMissedRound = chainState.knownMissedRounds.some(mr => mr.round === round);
        if (isMissedRound) {
          const missedRound = chainState.knownMissedRounds.find(mr => mr.round === round);
          this.logger.debug(
            `Chain ${chainId}: Block ${blockNumber} - Known missed round ${round}: Original ${missedRound.miner}, actual ${miner}`,
          );
        }
      }

      // Log performance and update state
      this.logger.log(
        `Chain ${chainId}: Processed ${blocks.length} blocks in ${(performance.now() - startTime).toFixed(2)}ms`,
      );

      chainState.lastCheckedBlock = latestBlockNumber;
      if (latestBlockResponse.result.timestamp) {
        chainState.lastBlockTimestamp = parseInt(latestBlockResponse.result.timestamp, 16);
      }
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
   */
  private async processMissedRound(chainId: number, missedRound: any): Promise<void> {
    try {
      const chainState = this.chainStates[chainId];
      const blockNumber = missedRound.CurrentBlockNum;
      const round = missedRound.Round;
      const expectedMiner = missedRound.Miner.toLowerCase();

      // Fetch current and parent blocks
      const blockHex = `0x${blockNumber.toString(16)}`;
      const currentBlockResponse = await chainState.rpcClient.call('eth_getBlockByNumber', [blockHex, false]);
      if (!currentBlockResponse?.result) {
        this.logger.warn(`Failed to fetch block ${blockNumber} for missed round verification`);
        return;
      }

      const prevBlockHex = `0x${missedRound.ParentBlockNum.toString(16)}`;
      const prevBlockResponse = await chainState.rpcClient.call('eth_getBlockByNumber', [prevBlockHex, false]);
      if (!prevBlockResponse?.result) {
        this.logger.warn(`Failed to fetch previous block ${missedRound.ParentBlockNum} for missed round verification`);
        return;
      }

      const actualMiner = currentBlockResponse.result.miner.toLowerCase();
      const timeoutPeriod =
        parseInt(currentBlockResponse.result.timestamp, 16) - parseInt(prevBlockResponse.result.timestamp, 16);

      // Calculate missed miners by comparing masternode list positions
      const validatorData = this.consensusMonitorService.getValidatorData(chainId);
      if (!validatorData?.masternodeList?.masternodes) {
        this.logger.warn(
          `Cannot determine missed miners accurately - masternode list not available for chain ${chainId}`,
        );
        return;
      }

      // Find positions in masternode list and calculate skipped miners
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

      // Record metrics for the missed round, including the count of missed miners
      this.metricsService.recordMissedRound(chainId, blockNumber, round, expectedMiner, actualMiner, missedMiners);

      // Record the timeout period (delay time) for this missed round
      this.metricsService.recordTimeoutPeriod(chainId, blockNumber, timeoutPeriod, TIMEOUT_THRESHOLD);

      // Create and record violation
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
        `Chain ${chainId} - Block ${blockNumber} - TIMEOUT: Expected ${expectedMiner} → actual ${actualMiner}, ` +
          `delay: ${timeoutPeriod}s, missed miners: ${missedMiners} (positions ${expectedMinerIndex} → ${actualMinerIndex})`,
      );

      // Generate a timeout alert if needed (unusual timeout or multiple miners missed)
      if (!isConsistentTimeout || missedMiners >= 2) {
        // Construct alert message directly in the condition to avoid unnecessary variable
        this.alertService.warning(
          ALERTS.TYPES.CONSENSUS_UNUSUAL_TIMEOUT,
          ALERTS.COMPONENTS.CONSENSUS,
          !isConsistentTimeout
            ? `Chain ${chainId} - Block ${blockNumber}: Unusual timeout of ${timeoutPeriod}s vs expected ${expectedTimeoutPeriod}s for ${missedMiners} missed miners.`
            : `Chain ${chainId} - Block ${blockNumber}: ${missedMiners} consecutive miners missed their turn.`,
          chainId,
        );
      }

      // Update miner's cumulative stats
      this.updateMinerMissedStats(chainId, expectedMiner);
    } catch (error) {
      this.logger.error(`Failed to process missed round for chain ${chainId}: ${error.message}`);
    }
  }

  /**
   * Update miner missed round statistics and trigger alerts at thresholds
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

    // Record missed round metric and updated performance
    this.metricsService.recordMinerMissedRound(chainId, address, minerStats.missedBlocks);
    this.metricsService.recordMinerPerformance(
      chainId,
      address,
      minerStats.totalBlocksMined,
      minerStats.missedBlocks,
      chainState.lastCheckedBlock,
    );

    // Alert at significant thresholds (every 10 missed rounds)
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
   */
  private recordViolation(chainId: number, violation: ConsensusViolation): void {
    const chainState = this.chainStates[chainId];

    // Use unshift to add to the front (most recent first)
    chainState.recentViolations.unshift(violation);

    // Limit collection size to prevent memory growth
    if (chainState.recentViolations.length > this.MAX_RECENT_VIOLATIONS) chainState.recentViolations.pop();
  }

  /**
   * Update miner performance when they successfully mine a block
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

    // Update stats and record performance
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
   */
  public getMinerPerformance(chainId: number): Record<string, MinerPerformance> {
    return this.chainStates[chainId]?.minerPerformance || {};
  }

  /**
   * Get recent consensus violations for API and dashboard display
   * Returns the 10 most recent violations for the specified chain
   */
  public getRecentViolations(chainId: number): ConsensusViolation[] {
    if (!this.chainStates[chainId]) {
      return [];
    }

    // Return only the 10 most recent violations
    return this.chainStates[chainId].recentViolations.slice(0, 10);
  }
}
