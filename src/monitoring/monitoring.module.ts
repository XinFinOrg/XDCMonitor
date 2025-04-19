import { BlockchainModule } from '@blockchain/blockchain.module';
import { MetricsManager } from '@common/utils/metrics-manager';
import { ConfigModule } from '@config/config.module';
import { MetricsModule } from '@metrics/metrics.module';
import { AlertModule } from '@alerts/alert.module';
import { BlocksMonitorService } from '@monitoring/blocks/blocks.monitor';
import { ConsensusModule } from '@monitoring/consensus/consensus.module';
import { MonitoringController } from '@monitoring/monitoring.controller';
import { RpcMonitorService } from '@monitoring/rpc/rpc.monitor';
import { PeerCountMonitor } from '@monitoring/rpc/peer-count.monitor';
import { TransactionMonitorService } from '@monitoring/transaction/transaction.monitor';
import { Module, forwardRef } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';

@Module({
  imports: [
    ScheduleModule.forRoot(),
    BlockchainModule,
    ConfigModule,
    MetricsModule,
    ConsensusModule,
    forwardRef(() => AlertModule),
  ],
  providers: [BlocksMonitorService, RpcMonitorService, TransactionMonitorService, MetricsManager, PeerCountMonitor],
  controllers: [MonitoringController],
  exports: [BlocksMonitorService, RpcMonitorService, TransactionMonitorService, ConsensusModule],
})
export class MonitoringModule {}
