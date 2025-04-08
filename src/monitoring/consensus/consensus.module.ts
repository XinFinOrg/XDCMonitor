import { Module, forwardRef } from '@nestjs/common';
import { ConsensusMonitor } from './consensus.monitor';
import { MinerMonitor } from './miner/miner.monitor';
import { EpochMonitor } from './epoch/epoch.monitor';
import { RewardMonitor } from './reward/reward.monitor';
import { BlockchainModule } from '@blockchain/blockchain.module';
import { ConfigModule } from '@config/config.module';
import { MetricsModule } from '@metrics/metrics.module';
import { AlertModule } from '@alerts/alert.module';
import { MonitoringModule } from '@monitoring/monitoring.module';

@Module({
  imports: [
    BlockchainModule,
    ConfigModule,
    MetricsModule,
    forwardRef(() => AlertModule),
    forwardRef(() => MonitoringModule),
  ],
  providers: [ConsensusMonitor, MinerMonitor, EpochMonitor, RewardMonitor],
  exports: [ConsensusMonitor, MinerMonitor, EpochMonitor, RewardMonitor],
})
export class ConsensusModule {}
