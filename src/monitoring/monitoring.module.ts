import { BlockchainModule } from '@blockchain/blockchain.module';
import { AlertManager } from '@common/utils/alert-manager';
import { MetricsManager } from '@common/utils/metrics-manager';
import { ConfigModule } from '@config/config.module';
import { MetricsModule } from '@metrics/metrics.module';
import { AlertsService } from '@monitoring/alerts.service';
import { BlocksMonitorService } from '@monitoring/blocks.monitor';
import { MonitoringController } from '@monitoring/monitoring.controller';
import { NotificationController } from '@monitoring/notification.controller';
import { RpcMonitorService } from '@monitoring/rpc.monitor';
import { TestingController } from '@monitoring/testing.controller';
import { TransactionMonitorService } from '@monitoring/transaction.monitor';
import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';

@Module({
  imports: [ScheduleModule.forRoot(), BlockchainModule, ConfigModule, MetricsModule],
  providers: [
    BlocksMonitorService,
    RpcMonitorService,
    AlertsService,
    TransactionMonitorService,
    AlertManager,
    MetricsManager,
  ],
  controllers: [MonitoringController, NotificationController, TestingController],
  exports: [BlocksMonitorService, RpcMonitorService, AlertsService, TransactionMonitorService],
})
export class MonitoringModule {}
