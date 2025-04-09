import { AlertService } from '@alerts/alert.service';
import { ALERTS } from '@common/constants/config';
import { MetricsService } from '@metrics/metrics.service';
import { ConsensusMonitor } from '@monitoring/consensus/consensus.monitor';
import { Inject, Injectable, Logger, forwardRef } from '@nestjs/common';

/**
 * Monitors XDC blockchain epochs, tracking penalties using a sliding window approach
 * Generates alerts for frequent penalties and large penalty lists
 */
@Injectable()
export class EpochMonitor {
  private readonly logger = new Logger(EpochMonitor.name);
  private readonly penaltyThresholdPercentage = 70; // Alert if node is penalized >= 70% of epochs
  private readonly maxPenaltyListSize = 20; // Alert if penalty list exceeds this size
  private readonly monitoringIntervalMs = 300000; // 5 minutes
  private readonly slidingWindowSize = 10; // Track the last 10 epochs

  // { chainId: { epoch: [addresses] } }
  private penaltyHistory: Record<number, Record<number, string[]>> = {};
  private processedEpochs: Record<number, number[]> = {};

  constructor(
    private readonly metricsService: MetricsService,
    private readonly alertService: AlertService,
    @Inject(forwardRef(() => ConsensusMonitor))
    private readonly consensusMonitor: ConsensusMonitor,
  ) {
    this.logger.log(`${EpochMonitor.name} initialized with sliding window of ${this.slidingWindowSize} epochs`);
  }

  public getScanIntervalMs = (): number => this.monitoringIntervalMs;

  /**
   * Main monitoring function that checks for penalties and generates alerts
   */
  async monitorEpochPenalties(chainId: number): Promise<void> {
    try {
      const validatorData = this.consensusMonitor.getValidatorData(chainId);
      if (!validatorData?.masternodeList) return this.logger.warn(`No validator data available for chain ${chainId}`);

      const { masternodeList, currentEpoch } = validatorData;

      this.updatePenaltyData(chainId, masternodeList.penalty, currentEpoch);
      await this.checkPenaltyListSize(chainId, masternodeList.penalty);
      await this.checkFrequentlyPenalizedNodes(chainId);

      this.logger.debug(
        `Monitored: chain=${chainId}, epoch=${currentEpoch}, penalties=${masternodeList.penalty.length}`,
      );
    } catch (error) {
      this.logger.error(`Error monitoring chain ${chainId}: ${error.message}`);
    }
  }

  /**
   * Alerts if penalty list size exceeds threshold
   */
  private async checkPenaltyListSize(chainId: number, penaltyList: string[]): Promise<void> {
    if (penaltyList.length < this.maxPenaltyListSize) return;

    const chainName = chainId === 50 ? 'Mainnet' : 'Testnet';
    const alertMessage = `Chain ${chainId} (${chainName}): Penalty list size (${penaltyList.length}) exceeds threshold (${this.maxPenaltyListSize})`;

    this.logger.warn(alertMessage);
    await this.alertService.warning(
      ALERTS.TYPES.CONSENSUS_PENALTY_LIST_SIZE_EXCEEDED,
      EpochMonitor.name,
      alertMessage,
      chainId,
    );
  }

  /**
   * Updates penalty history with new validator data
   * Maintains a sliding window of the last N epochs
   */
  public updatePenaltyData(chainId: number, penaltyList: string[], currentEpoch: number): void {
    try {
      // Initialize if not exists
      if (!this.penaltyHistory[chainId]) {
        this.penaltyHistory[chainId] = {};
        this.processedEpochs[chainId] = [];
      }

      if (this.processedEpochs[chainId].includes(currentEpoch)) return;

      // Add new epoch data and keep window sorted
      this.penaltyHistory[chainId][currentEpoch] = penaltyList.map(addr => addr.toLowerCase());
      this.processedEpochs[chainId].push(currentEpoch);
      this.processedEpochs[chainId].sort((a, b) => b - a);

      // Remove oldest epochs if exceeding window size
      if (this.processedEpochs[chainId].length > this.slidingWindowSize) {
        const oldEpochs = this.processedEpochs[chainId].slice(this.slidingWindowSize);
        oldEpochs.forEach(epoch => delete this.penaltyHistory[chainId][epoch]);
        this.processedEpochs[chainId] = this.processedEpochs[chainId].slice(0, this.slidingWindowSize);
      }
    } catch (error) {
      this.logger.error(`Error updating penalty data for chain ${chainId}: ${error.message}`);
    }
  }

  /**
   * Alerts for nodes frequently penalized in the sliding window
   */
  private async checkFrequentlyPenalizedNodes(chainId: number): Promise<void> {
    try {
      const epochs = this.processedEpochs[chainId] || [];
      if (epochs.length < 5) return;

      // Count penalties and filter nodes exceeding threshold
      const totalEpochs = epochs.length;
      const counts = this.countPenalties(chainId, epochs);
      const frequentNodes = Object.entries(counts)
        .map(([address, count]) => ({
          address,
          count,
          percentage: (count / totalEpochs) * 100,
        }))
        .filter(node => node.percentage >= this.penaltyThresholdPercentage);

      if (frequentNodes.length === 0) return;

      // Format alert with detailed node information
      const detailedList = frequentNodes
        .map(n => `${n.address} (${n.count}/${totalEpochs} epochs, ${n.percentage.toFixed(1)}%)`)
        .join('\n');

      const chainName = chainId === 50 ? 'Mainnet' : 'Testnet';
      const alertMessage = `Chain ${chainId} (${chainName}): ${frequentNodes.length} node(s) frequently penalized (>${this.penaltyThresholdPercentage}% of the last ${totalEpochs} epochs):\n${detailedList}`;

      this.logger.warn(alertMessage);
      await this.alertService.warning(
        ALERTS.TYPES.CONSENSUS_FREQUENT_PENALTY_NODES,
        EpochMonitor.name,
        alertMessage,
        chainId,
      );
    } catch (error) {
      this.logger.error(`Error checking frequent penalties for chain ${chainId}: ${error.message}`);
    }
  }

  /**
   * Counts penalty occurrences for each address
   */
  private countPenalties(chainId: number, epochs: number[]): Record<string, number> {
    const counts: Record<string, number> = {};

    epochs.forEach(epoch => {
      (this.penaltyHistory[chainId][epoch] || []).forEach(address => {
        counts[address] = (counts[address] || 0) + 1;
      });
    });

    return counts;
  }
}
