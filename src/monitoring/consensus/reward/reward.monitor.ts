import { AlertService } from '@alerts/alert.service';
import { BlockchainService } from '@blockchain/blockchain.service';
import { ConfigService } from '@config/config.service';
import { MetricsService } from '@metrics/metrics.service';
import { BlocksMonitorService } from '@monitoring/blocks/blocks.monitor';
import { ConsensusMonitor } from '@monitoring/consensus/consensus.monitor';
import { RpcMonitorService } from '@monitoring/rpc/rpc.monitor';
import { Injectable, Logger, OnModuleDestroy, OnModuleInit, Inject, forwardRef } from '@nestjs/common';
import { SchedulerRegistry } from '@nestjs/schedule';

/**
 * Service for monitoring XDC blockchain reward distribution
 *
 * This service will track reward distribution at epoch boundaries:
 * - Masternode rewards (~10% APY)
 * - Standbynode rewards (~7-8% APY)
 * - Verify penalized nodes receive no rewards
 */
@Injectable()
export class RewardMonitor implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RewardMonitor.name);

  constructor(
    private readonly blockchainService: BlockchainService,
    private readonly configService: ConfigService,
    private readonly blocksMonitorService: BlocksMonitorService,
    private readonly rpcMonitorService: RpcMonitorService,
    private readonly metricsService: MetricsService,
    private readonly alertService: AlertService,
    private readonly schedulerRegistry: SchedulerRegistry,
    @Inject(forwardRef(() => ConsensusMonitor))
    private readonly consensusMonitor: ConsensusMonitor,
  ) {}

  async onModuleInit() {
    this.logger.log(`${RewardMonitor.name} initialized`);
  }

  onModuleDestroy() {
    this.logger.log(`${RewardMonitor.name} destroyed`);
  }
}
