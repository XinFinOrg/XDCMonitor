import { Controller, Get, Param, ParseIntPipe, Post, Query, Logger } from '@nestjs/common';
import { RpcSelectorService } from './rpc-selector.service';
import { RpcMonitorService } from './rpc.monitor';
import { MAINNET_CHAIN_ID, TESTNET_CHAIN_ID } from '@common/constants/endpoints';
import { PeerCountMonitor } from './peer-count.monitor';
import { ConfigService } from '@config/config.service';

@Controller('api/monitoring/rpc')
export class RpcController {
  private readonly logger = new Logger(RpcController.name);

  constructor(
    private readonly rpcSelectorService: RpcSelectorService,
    private readonly rpcMonitorService: RpcMonitorService,
    private readonly peerCountMonitor: PeerCountMonitor,
    private readonly configService: ConfigService,
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

  /**
   * Test peer count monitoring for a specific endpoint
   */
  @Post('test-peer-count')
  async testPeerCount(@Query('endpoint') endpoint: string) {
    if (!endpoint) {
      return { success: false, message: 'Endpoint parameter is required' };
    }

    try {
      // Find the endpoint configuration
      const rpcEndpoints = this.configService.getRpcEndpoints();
      const endpointConfig = rpcEndpoints.find(e => e.url === endpoint);

      if (!endpointConfig) {
        return { success: false, message: `Endpoint ${endpoint} not found in configuration` };
      }

      this.logger.log(`Testing peer count monitoring for endpoint: ${endpoint}`);

      // Manually trigger peer count monitoring
      const alertTriggered = await this.peerCountMonitor.monitorRpcPeerCount(endpointConfig);

      return {
        success: true,
        message: `Peer count monitoring completed for ${endpoint}`,
        alertTriggered,
        endpoint: endpointConfig,
      };
    } catch (error) {
      this.logger.error(`Error testing peer count for ${endpoint}: ${error.message}`);
      return {
        success: false,
        message: `Error testing peer count: ${error.message}`,
      };
    }
  }
}
