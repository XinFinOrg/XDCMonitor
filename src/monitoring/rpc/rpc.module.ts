import { Module } from '@nestjs/common';
import { ConfigModule } from '@config/config.module';
import { BlockchainModule } from '@blockchain/blockchain.module';
import { MetricsModule } from '@metrics/metrics.module';
import { AlertModule } from '@alerts/alert.module';
import { RpcMonitorService } from './rpc.monitor';
import { PeerCountMonitor } from './peer-count.monitor';
import { RpcSelectorModule } from './rpc-selector.module';
import { RpcController } from './rpc.controller';

@Module({
  imports: [ConfigModule, BlockchainModule, MetricsModule, AlertModule, RpcSelectorModule],
  providers: [RpcMonitorService, PeerCountMonitor],
  controllers: [RpcController],
  exports: [RpcMonitorService, PeerCountMonitor],
})
export class RpcModule {}
