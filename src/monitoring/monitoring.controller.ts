import { Controller, Get } from '@nestjs/common';
import { RpcMonitorService } from '@monitoring/rpc/rpc.monitor';
import { BlocksMonitorService } from '@monitoring/blocks/blocks.monitor';
import { ConsensusMonitorService } from '@monitoring/consensus/consensus.monitor';
import { MinerMonitorService } from '@monitoring/consensus/miner/miner-monitor.service';

@Controller('monitoring')
export class MonitoringController {
  constructor(
    private readonly rpcMonitorService: RpcMonitorService,
    private readonly blocksMonitorService: BlocksMonitorService,
    private readonly consensusMonitorService: ConsensusMonitorService,
    private readonly minerMonitorService: MinerMonitorService,
  ) {}

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

  @Get('consensus-status')
  getConsensusStatus() {
    return {
      consensusMonitoring: this.consensusMonitorService.getConsensusMonitoringInfo(),
    };
  }

  @Get('masternode-performance')
  getMasternodePerformance() {
    return {
      masternodePerformance: this.minerMonitorService.getMinerPerformance(),
    };
  }

  @Get('consensus-violations')
  getConsensusViolations() {
    return {
      consensusViolations: this.minerMonitorService.getRecentViolations(),
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
        activeEndpoints: rpcStatus.filter(endpoint => endpoint.status === 'up').length,
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
}
