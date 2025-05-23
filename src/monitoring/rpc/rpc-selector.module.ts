import { Module } from '@nestjs/common';
import { ConfigModule } from '@config/config.module';
import { RpcSelectorService } from './rpc-selector.service';

@Module({
  imports: [ConfigModule],
  providers: [RpcSelectorService],
  exports: [RpcSelectorService],
})
export class RpcSelectorModule {}
