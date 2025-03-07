import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { BlockchainService } from '@blockchain/blockchain.service';
import { ConfigService, RpcEndpoint } from '@config/config.service';
import { MetricsService } from '@metrics/metrics.service';
import axios from 'axios';

let WebSocket;
try {
  WebSocket = require('ws');
} catch (error) {
  console.error('WebSocket library (ws) is not installed. WebSocket monitoring will be disabled.');
}

@Injectable()
export class RpcMonitorService implements OnModuleInit {
  private readonly logger = new Logger(RpcMonitorService.name);
  private rpcStatuses: Map<string, { status: 'up' | 'down'; latency: number }> = new Map();
  private wsStatuses: Map<string, { status: 'up' | 'down' }> = new Map();
  private rpcInterval: NodeJS.Timeout;
  private portInterval: NodeJS.Timeout;

  constructor(
    private readonly blockchainService: BlockchainService,
    private readonly configService: ConfigService,
    private readonly metricsService: MetricsService,
  ) {}

  onModuleInit() {
    this.startMonitoring();
  }

  startMonitoring() {
    this.initializeStatusMaps();

    const rpcCheckInterval = 30 * 1000; // Check every 30 seconds
    this.logger.log(`Starting RPC monitoring with interval of ${rpcCheckInterval / 1000} seconds`);

    this.rpcInterval = setInterval(() => {
      this.monitorAllRpcEndpoints();
    }, rpcCheckInterval);

    this.portInterval = setInterval(() => {
      this.monitorAllRpcPorts();
    }, 120 * 1000);

    this.monitorAllRpcEndpoints();
  }

  private initializeStatusMaps() {
    for (const endpoint of this.configService.rpcEndpoints) {
      this.rpcStatuses.set(endpoint.url, { status: 'up', latency: 0 });
    }

    for (const endpoint of this.configService.wsEndpoints) {
      this.wsStatuses.set(endpoint.url, { status: 'down' });
    }
  }

  async monitorAllRpcEndpoints() {
    if (!this.configService.enableRpcMonitoring) {
      return;
    }

    this.logger.debug('Checking all RPC endpoints status...');
    const startTime = Date.now();
    let checkedEndpoints = 0;
    let upEndpoints = 0;

    if (this.configService.enableMultiRpc) {
      for (const endpoint of this.configService.rpcEndpoints) {
        const status = await this.monitorRpcEndpoint(endpoint);
        checkedEndpoints++;
        if (status) upEndpoints++;
      }
    } else {
      const primaryEndpoint: RpcEndpoint = {
        url: this.configService.rpcUrl,
        name: 'Primary RPC',
        type: 'rpc',
        isMainnet: true,
      };
      const status = await this.monitorRpcEndpoint(primaryEndpoint);
      checkedEndpoints = 1;
      if (status) upEndpoints = 1;
    }

    const activeProvider = this.blockchainService.getActiveProvider();
    this.logger.debug(`Current active provider: ${activeProvider.endpoint.name} (${activeProvider.endpoint.url})`);

    const elapsedTime = Date.now() - startTime;
    this.logger.log(
      `RPC status check completed in ${elapsedTime}ms: ${upEndpoints}/${checkedEndpoints} endpoints available`,
    );
  }

  async monitorRpcEndpoint(endpoint: RpcEndpoint): Promise<boolean> {
    try {
      this.logger.debug(`Checking RPC endpoint: ${endpoint.name} (${endpoint.url})`);

      const startTime = Date.now();
      const isConnected = await this.blockchainService.checkRpcConnection(endpoint.url);
      const connectionCheckTime = Date.now() - startTime;

      if (!isConnected) {
        this.logger.warn(`RPC endpoint ${endpoint.name} (${endpoint.url}) is DOWN`);
        this.rpcStatuses.set(endpoint.url, { status: 'down', latency: 0 });

        // Update metrics
        this.metricsService.setRpcStatus(endpoint.url, false);

        return false;
      }

      // Check latency
      const latencyTime = await this.blockchainService.checkRpcLatency(endpoint.url);

      this.logger.debug(
        `RPC latency for ${endpoint.name}: ${latencyTime}ms (connection check: ${connectionCheckTime}ms)`,
      );
      this.rpcStatuses.set(endpoint.url, { status: 'up', latency: latencyTime });

      this.metricsService.setRpcStatus(endpoint.url, true);
      this.metricsService.recordRpcLatency(endpoint.url, latencyTime);

      return true;
    } catch (error) {
      this.logger.error(`Error checking RPC endpoint ${endpoint.name}: ${error.message}`);
      this.rpcStatuses.set(endpoint.url, { status: 'down', latency: 0 });

      // Update metrics
      this.metricsService.setRpcStatus(endpoint.url, false);

      return false;
    }
  }

  async monitorAllRpcPorts() {
    if (!this.configService.enablePortMonitoring) {
      return;
    }

    this.logger.debug('Checking all RPC ports...');

    if (this.configService.enableMultiRpc) {
      for (const endpoint of this.configService.rpcEndpoints) {
        await this.monitorRpcPort(endpoint);
      }

      for (const endpoint of this.configService.wsEndpoints) {
        await this.monitorWsPort(endpoint);
      }
    } else {
      const primaryRpcEndpoint: RpcEndpoint = {
        url: this.configService.rpcUrl,
        name: 'Primary RPC',
        type: 'rpc',
        isMainnet: true,
      };
      await this.monitorRpcPort(primaryRpcEndpoint);

      if (this.configService.wsUrl) {
        const primaryWsEndpoint: RpcEndpoint = {
          url: this.configService.wsUrl,
          name: 'Primary WebSocket',
          type: 'websocket',
          isMainnet: true,
        };
        await this.monitorWsPort(primaryWsEndpoint);
      }
    }
  }

  async monitorRpcPort(endpoint: RpcEndpoint) {
    try {
      const rpcUrl = new URL(endpoint.url);
      const domain = rpcUrl.hostname;
      const port = rpcUrl.port || (rpcUrl.protocol === 'https:' ? '443' : '80');

      try {
        await axios.get(`${rpcUrl.protocol}//${domain}:${port}`, {
          timeout: 5000,
        });
        this.logger.debug(`RPC port ${port} is open for ${endpoint.name}`);
      } catch (error) {
        if (error.code === 'ECONNREFUSED') {
          this.logger.warn(`RPC port ${port} is closed for ${endpoint.name}`);
        } else {
          this.logger.debug(`RPC port ${port} check for ${endpoint.name} returned: ${error.message}`);
        }
      }
    } catch (error) {
      this.logger.error(`Error monitoring port for ${endpoint.name}: ${error.message}`);
    }
  }

  async monitorWsPort(endpoint: RpcEndpoint) {
    try {
      if (!WebSocket) {
        this.logger.warn('WebSocket library not available. Skipping WebSocket monitoring.');
        return;
      }

      const wsUrl = endpoint.url;

      if (!wsUrl.startsWith('wss://') && !wsUrl.startsWith('ws://')) {
        this.logger.warn(`Invalid WebSocket URL for ${endpoint.name}: ${wsUrl} - Must start with ws:// or wss://`);
        this.wsStatuses.set(endpoint.url, { status: 'down' });
        return;
      }

      this.logger.debug(`Testing WebSocket connection to ${endpoint.name} (${wsUrl})`);

      const socket = new WebSocket(wsUrl, {
        handshakeTimeout: 5000, // Set handshake timeout to 5 seconds
        followRedirects: true, // Follow redirects if needed
      });

      let connectionSuccessful = false;

      const timeout = setTimeout(() => {
        if (!connectionSuccessful) {
          this.logger.warn(`WebSocket connection to ${endpoint.name} timed out`);
          this.wsStatuses.set(endpoint.url, { status: 'down' });
          socket.terminate();
        }
      }, 5000);

      socket.on('open', () => {
        connectionSuccessful = true;
        this.logger.debug(`WebSocket connection to ${endpoint.name} successful`);
        this.wsStatuses.set(endpoint.url, { status: 'up' });
        clearTimeout(timeout);
        socket.close();
      });

      socket.on('error', error => {
        this.logger.warn(`WebSocket connection error for ${endpoint.name}: ${error.message}`);
        this.wsStatuses.set(endpoint.url, { status: 'down' });
        clearTimeout(timeout);

        if (!socket.terminated) {
          socket.terminate();
        }
      });
    } catch (error) {
      this.logger.error(`Error setting up WebSocket connection for ${endpoint.name}: ${error.message}`);
      this.wsStatuses.set(endpoint.url, { status: 'down' });
    }
  }

  async testContractDeployment() {
    this.logger.debug('Testing contract deployment...');
  }

  getAllRpcStatuses() {
    const statuses = [];

    for (const endpoint of this.configService.rpcEndpoints) {
      const status = this.rpcStatuses.get(endpoint.url) || { status: 'unknown', latency: 0 };
      statuses.push({
        name: endpoint.name,
        url: endpoint.url,
        type: endpoint.type,
        status: status.status,
        latency: status.latency,
        isMainnet: endpoint.isMainnet,
      });
    }

    return statuses;
  }

  getAllWsStatuses() {
    const statuses = [];

    for (const endpoint of this.configService.wsEndpoints) {
      const status = this.wsStatuses.get(endpoint.url) || { status: 'unknown' };
      statuses.push({
        name: endpoint.name,
        url: endpoint.url,
        type: endpoint.type,
        status: status.status,
        isMainnet: endpoint.isMainnet,
      });
    }

    return statuses;
  }

  getRpcStatus() {
    const activeProvider = this.blockchainService.getActiveProvider();
    const status = this.rpcStatuses.get(activeProvider.endpoint.url) || { status: 'unknown', latency: 0 };

    return {
      status: status.status,
      wsStatus: this.getAnyWsStatus(),
      latency: status.latency,
      url: activeProvider.endpoint.url,
      wsUrl: this.configService.wsUrl,
    };
  }

  getAnyWsStatus(): 'up' | 'down' {
    for (const [, status] of this.wsStatuses) {
      if (status.status === 'up') {
        return 'up';
      }
    }
    return 'down';
  }
}
