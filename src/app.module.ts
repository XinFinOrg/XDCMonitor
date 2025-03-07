import { Module } from '@nestjs/common';
import { ConfigModule } from '@config/config.module';
import { BlockchainModule } from '@blockchain/blockchain.module';
import { MonitoringModule } from '@monitoring/monitoring.module';
import { MetricsModule } from '@metrics/metrics.module';

@Module({
  imports: [ConfigModule, BlockchainModule, MonitoringModule, MetricsModule],
})
export class AppModule {}
