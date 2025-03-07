import { Controller, Get } from '@nestjs/common';
import { RpcMonitorService } from '@monitoring/rpc.monitor';
import { BlocksMonitorService } from '@monitoring/blocks.monitor';

@Controller('monitoring')
export class MonitoringController {
  constructor(
    private readonly rpcMonitorService: RpcMonitorService,
    private readonly blocksMonitorService: BlocksMonitorService,
  ) {}

  @Get('rpc-status')
  getRpcStatus() {
    return {
      rpcStatus: this.rpcMonitorService.getRpcStatus(),
      rpcEndpoints: this.rpcMonitorService.getAllRpcStatuses(),
    };
  }

  @Get('websocket-status')
  getWebsocketStatus() {
    return {
      wsStatus: this.rpcMonitorService.getAnyWsStatus(),
      wsEndpoints: this.rpcMonitorService.getAllWsStatuses(),
    };
  }

  @Get('block-status')
  getBlockStatus() {
    return {
      blockMonitoring: this.blocksMonitorService.getBlockMonitoringInfo(),
    };
  }

  @Get('block-comparison')
  getBlockComparison() {
    const blockInfo = this.blocksMonitorService.getBlockMonitoringInfo();
    const rpcStatus = this.rpcMonitorService.getAllRpcStatuses();

    return {
      timestamp: new Date().toISOString(),
      blockComparison: {
        endpoints: blockInfo.monitoredEndpoints,
        blockTimeThreshold: blockInfo.blockTimeThreshold,
        totalEndpoints: rpcStatus.length,
        activeEndpoints: rpcStatus.filter(endpoint => endpoint.isUp).length,
        blockDifferences: this.calculateBlockDifferences(blockInfo.monitoredEndpoints),
        primaryEndpoint: blockInfo.primaryEndpoint,
      },
    };
  }

  private calculateBlockDifferences(endpoints) {
    if (!endpoints || endpoints.length <= 1) {
      return { maxDifference: 0, differences: [] };
    }

    const blockNumbers = endpoints.map(e => e.blockNumber);
    const maxBlock = Math.max(...blockNumbers);
    const minBlock = Math.min(...blockNumbers);
    const maxDifference = maxBlock - minBlock;

    const differences = [];
    for (let i = 0; i < endpoints.length; i++) {
      for (let j = i + 1; j < endpoints.length; j++) {
        const diff = Math.abs(endpoints[i].blockNumber - endpoints[j].blockNumber);
        if (diff > 0) {
          differences.push({
            endpoint1: endpoints[i].endpoint,
            endpoint2: endpoints[j].endpoint,
            difference: diff,
          });
        }
      }
    }

    return {
      maxDifference,
      differences: differences.sort((a, b) => b.difference - a.difference),
    };
  }

  @Get('status')
  getStatus() {
    return {
      blockMonitoring: this.blocksMonitorService.getBlockMonitoringInfo(),
      rpcMonitoringEnabled: true,
      rpc: {
        status: this.rpcMonitorService.getRpcStatus(),
        endpoints: this.rpcMonitorService.getAllRpcStatuses(),
      },
      websocket: {
        status: this.rpcMonitorService.getAnyWsStatus(),
        endpoints: this.rpcMonitorService.getAllWsStatuses(),
      },
    };
  }
}
