import { AlertService } from '@alerts/alert.service';
import { BlockchainService } from '@blockchain/blockchain.service';
import { RpcRetryClient } from '@common/utils/rpc-retry-client';
import { ConfigService } from '@config/config.service';
import { MetricsService } from '@metrics/metrics.service';
import { BlocksMonitorService } from '@monitoring/blocks/blocks.monitor';
import { ConsensusMonitorService } from '@monitoring/consensus/consensus.monitor';
import {
  TIMEOUT_THRESHOLD,
  checkEpochTransition,
  createRpcClient,
  getMonitoringConfig,
  getNextEpochBlock,
} from '@monitoring/consensus/consensus.utils';
import { RpcMonitorService } from '@monitoring/rpc/rpc.monitor';
import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { SchedulerRegistry } from '@nestjs/schedule';
import { ConsensusMonitoringInfo, ConsensusViolation, MinerPerformance } from '@types';
import { performance } from 'perf_hooks';

// Chain-specific state interface
interface ChainState {
  chainId: number;
  rpcClient: RpcRetryClient;
  lastCheckedBlock: number;
  lastBlockTimestamp: number;
  currentEpochBlock: number; // Block number where the current epoch started
  minerPerformance: Record<string, MinerPerformance>;
  recentViolations: ConsensusViolation[];
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
    private readonly consensusMonitorService: ConsensusMonitorService,
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
        minerPerformance: {},
        recentViolations: [],
      };
    });
  }

  async onModuleInit() {
    try {
      if (this.monitoringEnabled) {
        this.logger.log(`Initializing ${MinerMonitor.name}...`);

        // Initialize each chain
        for (const chainId of this.supportedChains) {
          // Register with the consensus monitor service for periodic checks
          this.consensusMonitorService.registerMonitoringInterval(
            `${MinerMonitor.name}-${chainId}`,
            () => this.monitorMiners(chainId),
            this.scanIntervalMs,
          );

          this.logger.log(`Monitoring enabled for chain ${chainId}`);
        }
      } else {
        this.logger.log(`${MinerMonitor.name} is disabled`);
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
    // Get validator data directly from the consensus service
    const validatorData = this.consensusMonitorService.getValidatorData(chainId);

    if (!this.monitoringEnabled || !chainState || !validatorData?.masternodeList) {
      return;
    }

    try {
      const startTime = performance.now();

      // Get latest block
      const latestBlock = await chainState.rpcClient.call('eth_getBlockByNumber', ['latest', true]);
      if (!latestBlock || !latestBlock.result) {
        throw new Error(`Could not fetch latest block for chain ${chainId}`);
      }

      const block = latestBlock.result;
      const blockNumber = parseInt(block.number, 16);
      const round = parseInt(block.round, 16);

      // Skip if we've already checked this block
      if (blockNumber <= chainState.lastCheckedBlock) {
        return;
      }

      // Check if we need to update epoch tracking
      // Only check if we have a valid epoch start block recorded
      if (validatorData.currentEpoch > 0) {
        try {
          // Check for epoch transition by looking at the last 1000 blocks
          const epochCheck = await checkEpochTransition(
            blockNumber,
            chainState.currentEpochBlock, // Use the current epoch block as reference
            chainState.rpcClient,
          );

          if (epochCheck.isNewEpoch) {
            this.logger.log(`Chain ${chainId}: Detected epoch transition at block ${epochCheck.latestEpochBlock}`);

            // Update our current epoch block
            chainState.currentEpochBlock = epochCheck.latestEpochBlock;

            // Update next epoch block for future reference
            const nextEpochBlock = await getNextEpochBlock(blockNumber, chainState.rpcClient);
            this.logger.log(`Chain ${chainId}: Next epoch will start around block ${nextEpochBlock}`);
          }
        } catch (error) {
          this.logger.error(`Chain ${chainId}: Error checking epoch boundary: ${error.message}`);
        }
      } else {
        // First run - initialize epoch tracking
        try {
          // Look back 1000 blocks to find the most recent epoch start
          const lookbackBlock = Math.max(1, blockNumber - 1000);
          const hexCurrentBlock = `0x${blockNumber.toString(16)}`;
          const hexLookbackBlock = `0x${lookbackBlock.toString(16)}`;

          const response = await chainState.rpcClient.call('XDPoS_getEpochNumbersBetween', [
            hexLookbackBlock,
            hexCurrentBlock,
          ]);

          if (response && response.result && Array.isArray(response.result) && response.result.length > 0) {
            // Set current epoch block to the most recent epoch start
            const epochBoundaries = response.result;
            chainState.currentEpochBlock = epochBoundaries[epochBoundaries.length - 1];
            this.logger.log(`Chain ${chainId}: Current epoch started at block ${chainState.currentEpochBlock}`);
          } else {
            // No epoch boundaries found in our lookback window
            // Set current epoch block to the current block number
            chainState.currentEpochBlock = blockNumber;
            this.logger.log(
              `Chain ${chainId}: No recent epoch boundaries found, setting current epoch block to ${chainState.currentEpochBlock}`,
            );
          }
        } catch (error) {
          this.logger.error(`Chain ${chainId}: Error initializing epoch tracking: ${error.message}`);
          // Set defaults
          chainState.currentEpochBlock = blockNumber;
        }
      }

      // Monitor consensus for this block
      await this.checkBlockConsensus(chainId, block);

      // Track performance
      const duration = performance.now() - startTime;

      // Log performance metrics through saveAlert
      const performanceAlert = {
        type: 'info' as const,
        title: `Chain ${chainId} - Miner Check Performance`,
        message: `Miner check took ${duration.toFixed(2)}ms`,
        timestamp: new Date(),
        component: 'consensus',
      };
      this.metricsService.saveAlert(performanceAlert);

      // Update state
      chainState.lastCheckedBlock = blockNumber;
      chainState.lastBlockTimestamp = parseInt(block.timestamp, 16);
    } catch (error) {
      this.logger.error(`Miner monitoring error for chain ${chainId}: ${error.message}`);

      // Log error through alert system
      const errorAlert = {
        type: 'error' as const,
        title: `Chain ${chainId} - Miner Monitoring Error`,
        message: error.message,
        timestamp: new Date(),
        component: 'consensus',
      };
      this.metricsService.saveAlert(errorAlert);
    }
  }

  /**
   * Check consensus for a specific block on a specific chain
   */
  private async checkBlockConsensus(chainId: number, block: any): Promise<void> {
    try {
      const chainState = this.chainStates[chainId];
      // Get validator data directly from the consensus service
      const validatorData = this.consensusMonitorService.getValidatorData(chainId);

      if (!validatorData?.masternodeList) {
        return;
      }

      const blockNumber = parseInt(block.number, 16);
      const round = parseInt(block.round, 16);
      const blockTimestamp = parseInt(block.timestamp, 16);
      const miner = block.miner.toLowerCase();

      // Calculate expected miner based on round number and masternode list
      const expectedMinerIndex = round % validatorData.masternodeList.masternodes.length;
      const expectedMiner = validatorData.masternodeList.masternodes[expectedMinerIndex].toLowerCase();

      // Update miner performance metrics
      this.updateMinerPerformance(chainId, miner, blockNumber);

      // Check if the block was mined by the expected masternode
      if (miner !== expectedMiner) {
        // Get the previous block to check for timeout
        const prevBlock = await chainState.rpcClient.call('eth_getBlockByNumber', [
          `0x${(blockNumber - 1).toString(16)}`,
          false,
        ]);

        if (prevBlock && prevBlock.result) {
          const prevTimestamp = parseInt(prevBlock.result.timestamp, 16);
          const timeDiff = blockTimestamp - prevTimestamp;

          // Check if this was a legitimate timeout (>= 10 seconds)
          if (timeDiff >= TIMEOUT_THRESHOLD) {
            // This was likely a timeout, expected behavior
            const violation: ConsensusViolation = {
              blockNumber,
              round,
              expectedMiner,
              actualMiner: miner,
              violationType: 'timeout',
              timestamp: new Date(),
              timeDifference: timeDiff,
            };

            this.recordViolation(chainId, violation);
            this.logTimeoutEvent(chainId, violation);

            // Update timeout count for the missed miner
            this.incrementMinerTimeout(chainId, expectedMiner);
          } else {
            // This is an unexpected miner (wrong order without timeout)
            const violation: ConsensusViolation = {
              blockNumber,
              round,
              expectedMiner,
              actualMiner: miner,
              violationType: 'wrong_miner',
              timestamp: new Date(),
            };

            this.recordViolation(chainId, violation);
            this.logWrongMinerEvent(chainId, violation);

            // This is a more serious issue - trigger an alert
            this.alertService.addAlert(
              {
                type: 'warning',
                title: `Chain ${chainId} - Consensus Wrong Miner`,
                message: `Block ${blockNumber} mined by wrong masternode: expected=${expectedMiner}, actual=${miner}`,
                component: 'consensus',
              },
              chainId,
            );
          }
        }
      } else {
        // Update metrics for correct mining via alert
        const correctMinerAlert = {
          type: 'info' as const,
          title: `Chain ${chainId} - Correct Miner Block`,
          message: `Block ${blockNumber} mined by correct masternode: ${miner}`,
          timestamp: new Date(),
          component: 'consensus',
        };
        this.metricsService.saveAlert(correctMinerAlert);
      }
    } catch (error) {
      this.logger.error(`Failed to check block consensus for chain ${chainId}: ${error.message}`);
    }
  }

  /**
   * Record a consensus violation for a specific chain
   */
  private recordViolation(chainId: number, violation: ConsensusViolation): void {
    const chainState = this.chainStates[chainId];

    // Add to recent violations list (limited size)
    chainState.recentViolations.unshift(violation);
    if (chainState.recentViolations.length > this.MAX_RECENT_VIOLATIONS) {
      chainState.recentViolations.pop();
    }

    // Update metrics through alert system
    const violationAlert = {
      type: violation.violationType === 'timeout' ? ('warning' as const) : ('error' as const),
      title: `Chain ${chainId} - Consensus ${violation.violationType === 'timeout' ? 'Timeout' : 'Violation'}`,
      message: `Block ${violation.blockNumber}: ${violation.violationType} - Expected ${violation.expectedMiner}, actual ${violation.actualMiner}`,
      timestamp: violation.timestamp,
      component: 'consensus',
    };
    this.metricsService.saveAlert(violationAlert);
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

    // Update stats
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

    // Track high timeout rates
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
   * Log timeout event for a specific chain
   */
  private logTimeoutEvent(chainId: number, violation: ConsensusViolation): void {
    this.logger.log(
      `Chain ${chainId} - Block ${violation.blockNumber} - TIMEOUT: Expected miner ${violation.expectedMiner} ` +
        `timed out after ${violation.timeDifference}s, mined by ${violation.actualMiner}`,
    );
  }

  /**
   * Log wrong miner event for a specific chain
   */
  private logWrongMinerEvent(chainId: number, violation: ConsensusViolation): void {
    this.logger.warn(
      `Chain ${chainId} - Block ${violation.blockNumber} - WRONG ORDER: Expected miner ${violation.expectedMiner}, ` +
        `but was mined by ${violation.actualMiner}`,
    );
  }

  /**
   * Get miner monitoring info for a specific chain or all chains
   */
  public getMinerMonitoringInfo(chainId?: number): ConsensusMonitoringInfo | Record<number, ConsensusMonitoringInfo> {
    if (chainId && this.chainStates[chainId]) {
      const chainState = this.chainStates[chainId];
      const validatorData = this.consensusMonitorService.getValidatorData(chainId);

      return {
        isEnabled: this.monitoringEnabled,
        chainId: chainId,
        lastCheckedBlock: chainState.lastCheckedBlock,
        currentEpoch: validatorData?.currentEpoch || 0,
        nextEpochBlock: validatorData?.nextEpochBlock || 0,
        currentEpochBlock: chainState.currentEpochBlock,
        masternodeCount: validatorData?.masternodeList?.masternodes.length || 0,
        standbyNodeCount: validatorData?.masternodeList?.standbynodes.length || 0,
        penaltyNodeCount: validatorData?.masternodeList?.penalty.length || 0,
        recentViolations: chainState.recentViolations.slice(0, 10), // Return only 10 most recent
        minerPerformance: chainState.minerPerformance,
      };
    }

    // Return monitoring info for all chains
    const result: Record<number, ConsensusMonitoringInfo> = {};
    for (const chainId of this.supportedChains) {
      const chainState = this.chainStates[chainId];
      const validatorData = this.consensusMonitorService.getValidatorData(chainId);

      result[chainId] = {
        isEnabled: this.monitoringEnabled,
        chainId: chainId,
        lastCheckedBlock: chainState.lastCheckedBlock,
        currentEpoch: validatorData?.currentEpoch || 0,
        nextEpochBlock: validatorData?.nextEpochBlock || 0,
        currentEpochBlock: chainState.currentEpochBlock,
        masternodeCount: validatorData?.masternodeList?.masternodes.length || 0,
        standbyNodeCount: validatorData?.masternodeList?.standbynodes.length || 0,
        penaltyNodeCount: validatorData?.masternodeList?.penalty.length || 0,
        recentViolations: chainState.recentViolations.slice(0, 10), // Return only 10 most recent
        minerPerformance: chainState.minerPerformance,
      };
    }
    return result;
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
