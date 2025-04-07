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
 * Service for monitoring XDC blockchain epoch transitions
 *
 * This service will track epoch changes (every 900 blocks), masternode list updates,
 * and transitions between masternode/standbynode status.
 */
@Injectable()
export class EpochMonitor implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(EpochMonitor.name);

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
    this.logger.log(`${EpochMonitor.name} initialized`);
  }

  onModuleDestroy() {
    this.logger.log(`${EpochMonitor.name} destroyed`);
  }
}
