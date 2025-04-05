import { BlockchainModule } from '@blockchain/blockchain.module';
import { AlertManager } from '@common/utils/alert-manager';
import { MetricsManager } from '@common/utils/metrics-manager';
import { ConfigModule } from '@config/config.module';
import { MetricsModule } from '@metrics/metrics.module';
import { AlertModule } from '@alerts/alert.module';
import { BlocksMonitorService } from '@monitoring/blocks/blocks.monitor';
import { ConsensusMonitorService } from '@monitoring/consensus/consensus.monitor';
import { MinerMonitor } from '@monitoring/consensus/miner/miner.monitor';
import { EpochMonitor } from '@monitoring/consensus/epoch/epoch.monitor';
import { RewardMonitor } from '@monitoring/consensus/reward/reward.monitor';
import { MonitoringController } from '@monitoring/monitoring.controller';
import { RpcMonitorService } from '@monitoring/rpc/rpc.monitor';
import { TransactionMonitorService } from '@monitoring/transaction/transaction.monitor';
import { Module, forwardRef } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';

@Module({
  imports: [ScheduleModule.forRoot(), BlockchainModule, ConfigModule, MetricsModule, forwardRef(() => AlertModule)],
  providers: [
    // Core services
    BlocksMonitorService,
    RpcMonitorService,
    TransactionMonitorService,
    MetricsManager,

    // Consensus monitoring - important: main service must come before individual monitors
    ConsensusMonitorService, // This needs to be initialized before the monitors
    MinerMonitor,
    EpochMonitor,
    RewardMonitor,
  ],
  controllers: [MonitoringController],
  exports: [BlocksMonitorService, RpcMonitorService, TransactionMonitorService, ConsensusMonitorService],
})
export class MonitoringModule {}
