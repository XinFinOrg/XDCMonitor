import { BlockchainModule } from '@blockchain/blockchain.module';
import { AlertManager } from '@common/utils/alert-manager';
import { MetricsManager } from '@common/utils/metrics-manager';
import { ConfigModule } from '@config/config.module';
import { MetricsModule } from '@metrics/metrics.module';
import { AlertModule } from '@alerts/alert.module';
import { BlocksMonitorService } from '@monitoring/blocks.monitor';
import { MonitoringController } from '@monitoring/monitoring.controller';
import { RpcMonitorService } from '@monitoring/rpc.monitor';
import { TransactionMonitorService } from '@monitoring/transaction.monitor';
import { Module, forwardRef } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';

@Module({
  imports: [ScheduleModule.forRoot(), BlockchainModule, ConfigModule, MetricsModule, forwardRef(() => AlertModule)],
  providers: [BlocksMonitorService, RpcMonitorService, TransactionMonitorService, MetricsManager],
  controllers: [MonitoringController],
  exports: [BlocksMonitorService, RpcMonitorService, TransactionMonitorService],
})
export class MonitoringModule {}
