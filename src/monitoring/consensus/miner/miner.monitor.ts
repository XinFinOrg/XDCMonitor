import { AlertService } from '@alerts/alert.service';
import { BlockchainService } from '@blockchain/blockchain.service';
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
    // Initialize configuration and services
    const config = getMonitoringConfig(this.configService);
    this.monitoringEnabled = config.enabled;
    this.scanIntervalMs = config.scanIntervalMs;
    this.supportedChains = config.chains;

    // Initialize state for each chain
    this.initializeChainStates();
  }

  private initializeChainStates(): void {
    this.supportedChains.forEach(chainId => {
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
   * Main monitoring miners logic for a specific chain
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

      if (chainState.lastMissedRoundsCheck === 0 || latestBlockNumber - chainState.lastMissedRoundsCheck >= 50) {
        await this.updateMissedRounds(chainId);
        chainState.lastMissedRoundsCheck = latestBlockNumber;
      }

      const startBlockNum = chainState.lastCheckedBlock + 1;
      const blockCount = latestBlockNumber - startBlockNum + 1;

      this.logger.log(`Chain ${chainId}: Checking ${blockCount} blocks from ${startBlockNum} to ${latestBlockNumber}`);

      const blocks = await fetchBlockBatch(
        chainState.rpcClient,
        startBlockNum,
        latestBlockNumber,
        Math.min(50, blockCount),
        true,
      );

      let blocksChecked = 0;
      for (const block of blocks) {
        const blockNumber = parseInt(block.number, 16);
        const round = parseInt(block.round, 16);
        const miner = block.miner.toLowerCase();

        // Update miner performance metrics
        this.updateMinerPerformance(chainId, miner, blockNumber);

        // Check if this is a known missed round
        if (chainState.knownMissedRounds.some(mr => mr.round === round)) {
          const missedRound = chainState.knownMissedRounds.find(mr => mr.round === round);
          this.logger.debug(
            `Chain ${chainId}: Block ${blockNumber} - Processing known missed round ${round} - ` +
              `Original miner was ${missedRound.miner}, actual miner is ${miner}`,
          );
        } else {
          this.logger.debug(`Chain ${chainId}: Processed block ${blockNumber} (round ${round}) mined by ${miner}`);
        }

        blocksChecked++;
      }

      this.metricsService.saveAlert({
        type: 'info',
        title: `Chain ${chainId} - Miner Check Performance`,
        message: `Checked ${blocksChecked} of ${blockCount} blocks in ${(performance.now() - startTime).toFixed(2)}ms`,
        timestamp: new Date(),
        component: 'consensus',
      });

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
   * Update missed rounds information from the blockchain to the chain state
   */
  private async updateMissedRounds(chainId: number): Promise<void> {
    try {
      const chainState = this.chainStates[chainId];
      const missedRoundsData = await getMissedRoundsForEpoch(chainState.rpcClient);

      if (!missedRoundsData) return;

      if (chainState.currentEpochBlock !== missedRoundsData.EpochBlockNumber) {
        this.logger.log(
          `Chain ${chainId}: Updating state for missed rounds - epoch block: ${chainState.currentEpochBlock} to ${missedRoundsData.EpochBlockNumber}`,
        );
        chainState.currentEpochBlock = missedRoundsData.EpochBlockNumber;
      }

      chainState.epochRound = missedRoundsData.EpochRound;
      const existingRounds = new Set(chainState.knownMissedRounds.map(mr => mr.round));

      chainState.knownMissedRounds = missedRoundsData.MissedRounds.map(mr => ({
        round: mr.Round,
        miner: mr.Miner.toLowerCase(),
        blockNumber: mr.CurrentBlockNum,
      }));

      const newMissedRounds = missedRoundsData.MissedRounds.filter(mr => !existingRounds.has(mr.Round));

      if (newMissedRounds.length > 0) {
        this.logger.log(`Chain ${chainId}: Discovered ${newMissedRounds.length} new missed rounds from blockchain API`);

        for (const missedRound of newMissedRounds) {
          await this.verifyTimeoutPeriod(chainId, missedRound);
          this.incrementMinerTimeout(chainId, missedRound.Miner.toLowerCase());
        }
      }

      this.logger.log(
        `Chain ${chainId}: Updated state for missed rounds - epoch block: ${chainState.currentEpochBlock}, ` +
          `epoch round: ${chainState.epochRound}, missed rounds: ${chainState.knownMissedRounds.length}`,
      );

      if (chainState.knownMissedRounds.length > 0) {
        this.logger.debug(`Chain ${chainId}: Missed rounds: ${JSON.stringify(chainState.knownMissedRounds)}`);
      }
    } catch (error) {
      this.logger.error(`Chain ${chainId}: Failed to update missed rounds: ${error.message}`);
    }
  }

  /**
   * Verify the timeout period for a missed round by examining blocks before and after
   */
  private async verifyTimeoutPeriod(chainId: number, missedRound: any): Promise<void> {
    try {
      const chainState = this.chainStates[chainId];
      const blockHex = `0x${missedRound.CurrentBlockNum.toString(16)}`;
      const currentBlockResponse = await chainState.rpcClient.call('eth_getBlockByNumber', [blockHex, false]);

      if (!currentBlockResponse?.result) {
        this.logger.warn(`Failed to fetch block ${missedRound.CurrentBlockNum} for missed round verification`);
        return;
      }

      const prevBlockHex = `0x${missedRound.ParentBlockNum.toString(16)}`;
      const prevBlockResponse = await chainState.rpcClient.call('eth_getBlockByNumber', [prevBlockHex, false]);

      if (!prevBlockResponse?.result) {
        this.logger.warn(`Failed to fetch previous block ${missedRound.ParentBlockNum} for missed round verification`);
        return;
      }

      const timeoutPeriod =
        parseInt(currentBlockResponse.result.timestamp, 16) - parseInt(prevBlockResponse.result.timestamp, 16);

      const violation: ConsensusViolation = {
        blockNumber: missedRound.CurrentBlockNum,
        round: missedRound.Round,
        expectedMiner: missedRound.Miner.toLowerCase(),
        actualMiner: currentBlockResponse.result.miner.toLowerCase(),
        violationType: 'timeout',
        timestamp: new Date(),
        timeDifference: timeoutPeriod,
      };

      this.recordViolation(chainId, violation);
      this.logTimeoutEvent(chainId, violation);

      if (Math.abs(timeoutPeriod - TIMEOUT_THRESHOLD) > 2) {
        this.alertService.addAlert(
          {
            type: 'warning',
            title: `Chain ${chainId} - Unusual Timeout Period`,
            message: `Block ${missedRound.CurrentBlockNum}: Timeout period was ${timeoutPeriod}s instead of expected ${TIMEOUT_THRESHOLD}s`,
            component: 'consensus',
          },
          chainId,
        );
      }
    } catch (error) {
      this.logger.error(`Failed to verify timeout period for chain ${chainId}: ${error.message}`);
    }
  }

  /**
   * Record a consensus violation for a specific chain
   */
  private recordViolation(chainId: number, violation: ConsensusViolation): void {
    const chainState = this.chainStates[chainId];
    chainState.recentViolations.unshift(violation);

    if (chainState.recentViolations.length > this.MAX_RECENT_VIOLATIONS) {
      chainState.recentViolations.pop();
    }

    this.metricsService.saveAlert({
      type: violation.violationType === 'timeout' ? 'warning' : 'error',
      title: `Chain ${chainId} - Consensus ${violation.violationType === 'timeout' ? 'Timeout' : 'Violation'}`,
      message: `Block ${violation.blockNumber}: ${violation.violationType} - Expected ${violation.expectedMiner}, actual ${violation.actualMiner}`,
      timestamp: violation.timestamp,
      component: 'consensus',
    });
  }

  /**
   * Log timeout event for a specific chain
   */
  private logTimeoutEvent(chainId: number, violation: ConsensusViolation): void {
    this.logger.log(
      `Chain ${chainId} - Block ${violation.blockNumber} - TIMEOUT: Expected miner ${violation.expectedMiner} ` +
        `timed out after ${violation.timeDifference}s, mined by ${violation.actualMiner}`,
    );
  }

  /**
   * Update performance tracking for a miner on a specific chain
   */
  private updateMinerPerformance(chainId: number, address: string, blockNumber: number): void {
    const chainState = this.chainStates[chainId];
    address = address.toLowerCase();

    if (!chainState.minerPerformance[address]) {
      chainState.minerPerformance[address] = {
        address,
        totalBlocksMined: 0,
        missedBlocks: 0,
        timeoutCount: 0,
      };
    }

    chainState.minerPerformance[address].totalBlocksMined++;
    chainState.minerPerformance[address].lastActiveBlock = blockNumber;
    chainState.minerPerformance[address].lastActive = new Date();
  }

  /**
   * Increment timeout count for a miner on a specific chain
   */
  private incrementMinerTimeout(chainId: number, address: string): void {
    const chainState = this.chainStates[chainId];
    address = address.toLowerCase();

    if (!chainState.minerPerformance[address]) {
      chainState.minerPerformance[address] = {
        address,
        totalBlocksMined: 0,
        missedBlocks: 0,
        timeoutCount: 0,
      };
    }

    chainState.minerPerformance[address].timeoutCount++;
    chainState.minerPerformance[address].missedBlocks++;

    if (chainState.minerPerformance[address].timeoutCount % 10 === 0) {
      this.alertService.warning(
        'consensus_frequent_timeouts',
        'consensus',
        `Chain ${chainId} - Masternode ${address} has timed out ${chainState.minerPerformance[address].timeoutCount} times`,
        chainId,
      );
    }
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
   * Get recent consensus violations for a specific chain
   */
  public getRecentViolations(chainId: number): ConsensusViolation[] {
    return this.chainStates[chainId]?.recentViolations.slice(0, 10) || [];
  }
}
