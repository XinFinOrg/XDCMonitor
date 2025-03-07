import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { BlockchainModule } from '@blockchain/blockchain.module';
import { ConfigModule } from '@config/config.module';
import { MetricsModule } from '@metrics/metrics.module';
import { BlocksMonitorService } from '@monitoring/blocks.monitor';
import { RpcMonitorService } from '@monitoring/rpc.monitor';
import { AlertsService } from '@monitoring/alerts.service';
import { MonitoringController } from '@monitoring/monitoring.controller';
import { NotificationController } from '@monitoring/notification.controller';
import { TestingController } from '@monitoring/testing.controller';

@Module({
  imports: [ScheduleModule.forRoot(), BlockchainModule, ConfigModule, MetricsModule],
  providers: [BlocksMonitorService, RpcMonitorService, AlertsService],
  controllers: [MonitoringController, NotificationController, TestingController],
  exports: [BlocksMonitorService, RpcMonitorService, AlertsService],
})
export class MonitoringModule {}
