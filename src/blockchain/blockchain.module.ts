import { Module } from '@nestjs/common';
import { BlockchainService } from '@blockchain/blockchain.service';
import { ConfigModule } from '@config/config.module';
import { RpcSelectorModule } from '@monitoring/rpc/rpc-selector.module';

@Module({
  imports: [ConfigModule, RpcSelectorModule],
  providers: [BlockchainService],
  exports: [BlockchainService],
})
export class BlockchainModule {}
