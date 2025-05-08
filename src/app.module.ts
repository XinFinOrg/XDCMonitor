import { AlertModule } from '@alerts/alert.module';
import { BlockchainModule } from '@blockchain/blockchain.module';
import { ConfigModule } from '@config/config.module';
import { MetricsModule } from '@metrics/metrics.module';
import { MonitoringModule } from '@monitoring/monitoring.module';
import { Module } from '@nestjs/common';

@Module({
  imports: [ConfigModule, BlockchainModule, MonitoringModule, MetricsModule, AlertModule],
})
export class AppModule {}
