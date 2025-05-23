import { Controller, Get, Param, ParseIntPipe } from '@nestjs/common';
import { RpcSelectorService } from './rpc-selector.service';
import { RpcMonitorService } from './rpc.monitor';
import { MAINNET_CHAIN_ID, TESTNET_CHAIN_ID } from '@common/constants/endpoints';

@Controller('api/monitoring/rpc')
export class RpcController {
  constructor(
    private readonly rpcSelectorService: RpcSelectorService,
    private readonly rpcMonitorService: RpcMonitorService,
  ) {}

  /**
   * Get health metrics for all RPC endpoints
   */
  @Get('health')
  getAllRpcHealth(): any {
    return {
      mainnet: this.rpcSelectorService.getEndpointHealthForChain(MAINNET_CHAIN_ID),
      testnet: this.rpcSelectorService.getEndpointHealthForChain(TESTNET_CHAIN_ID),
    };
  }

  /**
   * Get health metrics for a specific chain
   */
  @Get('health/:chainId')
  getRpcHealthForChain(@Param('chainId', ParseIntPipe) chainId: number): any {
    return this.rpcSelectorService.getEndpointHealthForChain(chainId);
  }

  /**
   * Get the currently selected primary RPC endpoints
   */
  @Get('primary')
  getPrimaryRpcEndpoints() {
    return {
      mainnet: this.rpcSelectorService.getPrimaryRpcUrl(MAINNET_CHAIN_ID),
      testnet: this.rpcSelectorService.getPrimaryRpcUrl(TESTNET_CHAIN_ID),
    };
  }

  /**
   * Get the currently selected primary RPC for a specific chain
   */
  @Get('primary/:chainId')
  getPrimaryRpcForChain(@Param('chainId', ParseIntPipe) chainId: number) {
    return {
      chainId,
      url: this.rpcSelectorService.getPrimaryRpcUrl(chainId),
    };
  }

  /**
   * Get the current status of all RPC endpoints
   */
  @Get('status')
  getRpcStatus() {
    return {
      rpc: this.rpcMonitorService.getAllRpcStatuses(),
      websocket: this.rpcMonitorService.getAllWsStatuses(),
      explorer: this.rpcMonitorService.getAllExplorerStatuses(),
      faucet: this.rpcMonitorService.getAllFaucetStatuses(),
    };
  }
}
