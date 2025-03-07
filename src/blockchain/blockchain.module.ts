import { Module } from '@nestjs/common';
import { BlockchainService } from '@blockchain/blockchain.service';
import { ConfigModule } from '@config/config.module';

@Module({
  imports: [ConfigModule],
  providers: [BlockchainService],
  exports: [BlockchainService],
})
export class BlockchainModule {}
