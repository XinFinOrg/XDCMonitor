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
  private explorerStatuses: Map<string, { status: 'up' | 'down' }> = new Map();
  private faucetStatuses: Map<string, { status: 'up' | 'down' }> = new Map();
  private rpcInterval: NodeJS.Timeout;
  private portInterval: NodeJS.Timeout;
  private servicesInterval: NodeJS.Timeout;

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
    }, 30 * 1000);

    this.servicesInterval = setInterval(() => {
      this.monitorAllServices();
    }, 30 * 1000); // Check services every minute

    this.monitorAllRpcEndpoints();
    this.monitorAllServices();
  }

  private initializeStatusMaps() {
    for (const endpoint of this.configService.rpcEndpoints) {
      this.rpcStatuses.set(endpoint.url, { status: 'up', latency: 0 });
    }

    for (const endpoint of this.configService.wsEndpoints) {
      this.wsStatuses.set(endpoint.url, { status: 'down' });
    }

    // Initialize explorer statuses
    if (this.configService.explorerEndpoints) {
      for (const endpoint of this.configService.explorerEndpoints) {
        this.explorerStatuses.set(endpoint.url, { status: 'down' });
      }
    }

    // Initialize faucet statuses
    if (this.configService.faucetEndpoints) {
      for (const endpoint of this.configService.faucetEndpoints) {
        this.faucetStatuses.set(endpoint.url, { status: 'down' });
      }
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

    for (const endpoint of this.configService.rpcEndpoints) {
      const status = await this.monitorRpcEndpoint(endpoint);
      checkedEndpoints++;
      if (status) upEndpoints++;
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

      const startTime = performance.now();
      const response = await axios.post(
        endpoint.url,
        {
          jsonrpc: '2.0',
          method: 'eth_blockNumber',
          params: [],
          id: 1,
        },
        {
          timeout: 10000,
          headers: { 'Content-Type': 'application/json' },
        },
      );

      const elapsedTime = performance.now() - startTime;

      this.metricsService.recordRpcLatency(endpoint.url, elapsedTime, endpoint.chainId);

      const isSuccessful = response.status === 200 && response.data && response.data.result;

      if (isSuccessful) {
        this.logger.debug(`RPC endpoint ${endpoint.name} is UP (${elapsedTime}ms)`);
        this.rpcStatuses.set(endpoint.url, { status: 'up', latency: elapsedTime });

        this.metricsService.setRpcStatus(endpoint.url, true, endpoint.chainId);

        return true;
      } else {
        this.logger.warn(`RPC endpoint ${endpoint.name} returned invalid response`);
        this.rpcStatuses.set(endpoint.url, { status: 'down', latency: elapsedTime });

        this.metricsService.setRpcStatus(endpoint.url, false, endpoint.chainId);

        return false;
      }
    } catch (error) {
      this.logger.warn(`RPC endpoint ${endpoint.name} is DOWN: ${error.message}`);
      this.rpcStatuses.set(endpoint.url, { status: 'down', latency: 0 });

      // Update metrics with chainId
      this.metricsService.setRpcStatus(endpoint.url, false, endpoint.chainId);

      return false;
    }
  }

  async monitorAllRpcPorts() {
    if (!this.configService.enablePortMonitoring) {
      return;
    }

    this.logger.debug('Checking all RPC ports...');

    // Monitor all RPC endpoints regardless of enableMultiRpc setting
    for (const endpoint of this.configService.rpcEndpoints) {
      await this.monitorRpcPort(endpoint);
    }

    for (const endpoint of this.configService.wsEndpoints) {
      await this.monitorWsPort(endpoint);
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
        this.metricsService.setWebsocketStatus(endpoint.url, false, endpoint.chainId);
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
          this.metricsService.setWebsocketStatus(endpoint.url, false, endpoint.chainId);
          socket.terminate();
        }
      }, 5000);

      socket.on('open', () => {
        connectionSuccessful = true;
        this.logger.debug(`WebSocket connection to ${endpoint.name} successful`);
        this.wsStatuses.set(endpoint.url, { status: 'up' });
        this.metricsService.setWebsocketStatus(endpoint.url, true, endpoint.chainId);
        clearTimeout(timeout);
        socket.close();
      });

      socket.on('error', error => {
        this.logger.warn(`WebSocket connection error for ${endpoint.name}: ${error.message}`);
        this.wsStatuses.set(endpoint.url, { status: 'down' });
        this.metricsService.setWebsocketStatus(endpoint.url, false, endpoint.chainId);
        clearTimeout(timeout);

        if (!socket.terminated) {
          socket.terminate();
        }
      });
    } catch (error) {
      this.logger.error(`Error setting up WebSocket connection for ${endpoint.name}: ${error.message}`);
      this.wsStatuses.set(endpoint.url, { status: 'down' });
      this.metricsService.setWebsocketStatus(endpoint.url, false, endpoint.chainId);
    }
  }

  async monitorAllServices() {
    if (!this.configService.enableRpcMonitoring) {
      return;
    }

    this.logger.debug('Checking all services status...');

    if (this.configService.explorerEndpoints) {
      let explorerChecked = 0;
      let explorerUp = 0;

      for (const endpoint of this.configService.explorerEndpoints) {
        const status = await this.monitorService(endpoint);
        explorerChecked++;
        if (status) explorerUp++;

        this.metricsService.setExplorerStatus(endpoint.url, status, endpoint.chainId);
      }

      this.logger.debug(`Explorer status check completed: ${explorerUp}/${explorerChecked} explorers available`);
    }

    if (this.configService.faucetEndpoints) {
      let faucetChecked = 0;
      let faucetUp = 0;

      for (const endpoint of this.configService.faucetEndpoints) {
        const status = await this.monitorService(endpoint);
        faucetChecked++;
        if (status) faucetUp++;

        this.metricsService.setFaucetStatus(endpoint.url, status, endpoint.chainId);
      }

      this.logger.debug(`Faucet status check completed: ${faucetUp}/${faucetChecked} faucets available`);
    }
  }

  async monitorService(endpoint: RpcEndpoint): Promise<boolean> {
    try {
      this.logger.debug(`Checking service: ${endpoint.name} (${endpoint.url})`);

      const response = await axios.get(endpoint.url, {
        timeout: 5000,
        validateStatus: null,
      });

      const isUp = response.status >= 200 && response.status < 500;

      if (endpoint.url.includes('explorer') || endpoint.url.includes('scan')) {
        this.explorerStatuses.set(endpoint.url, { status: isUp ? 'up' : 'down' });
        this.metricsService.setExplorerStatus(endpoint.url, isUp, endpoint.chainId);
      } else if (endpoint.url.includes('faucet')) {
        this.faucetStatuses.set(endpoint.url, { status: isUp ? 'up' : 'down' });
        this.metricsService.setFaucetStatus(endpoint.url, isUp, endpoint.chainId);
      }

      this.logger.debug(`Service ${endpoint.name} is ${isUp ? 'UP' : 'DOWN'}`);
      return isUp;
    } catch (error) {
      this.logger.debug(`Service ${endpoint.name} check failed: ${error.message}`);

      if (endpoint.url.includes('explorer') || endpoint.url.includes('scan')) {
        this.explorerStatuses.set(endpoint.url, { status: 'down' });
        this.metricsService.setExplorerStatus(endpoint.url, false, endpoint.chainId);
      } else if (endpoint.url.includes('faucet')) {
        this.faucetStatuses.set(endpoint.url, { status: 'down' });
        this.metricsService.setFaucetStatus(endpoint.url, false, endpoint.chainId);
      }

      return false;
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
        chainId: endpoint.chainId,
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
        chainId: endpoint.chainId,
      });
    }

    return statuses;
  }

  getAllExplorerStatuses() {
    const result = {};
    for (const [url, status] of this.explorerStatuses.entries()) {
      result[url] = status.status;
    }
    return result;
  }

  getAllFaucetStatuses() {
    const result = {};
    for (const [url, status] of this.faucetStatuses.entries()) {
      result[url] = status.status;
    }
    return result;
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
