import { BlockchainService } from '@blockchain/blockchain.service';
import { ALERTS, BLOCKCHAIN, PERFORMANCE } from '@common/constants/config';
import { RpcRetryClient } from '@common/utils/rpc-retry-client';
import { ConfigService } from '@config/config.service';
import { MetricsService } from '@metrics/metrics.service';
import { AlertsService } from '@monitoring/alerts.service';
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { RpcEndpoint } from '@types';
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

  // Map of RPC clients by endpoint URL
  private rpcClients: Map<string, RpcRetryClient> = new Map();

  constructor(
    private readonly blockchainService: BlockchainService,
    private readonly configService: ConfigService,
    private readonly metricsService: MetricsService,
    private readonly alertsService: AlertsService,
  ) {}

  onModuleInit() {
    this.startMonitoring();
  }

  startMonitoring() {
    this.initializeStatusMaps();
    this.initializeRpcClients();

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
    }, 60 * 1000);

    // Sync with blockchain service periodically to keep provider statuses consistent
    setInterval(() => {
      this.syncWithBlockchainService();
    }, 60 * 1000); // Every minute

    // Run initial checks
    this.monitorAllRpcEndpoints();
    this.monitorAllRpcPorts();
    this.monitorAllServices();
    this.syncWithBlockchainService();
  }

  /**
   * Initialize RPC clients for all endpoints
   */
  private initializeRpcClients() {
    const rpcEndpoints = this.configService.getRpcEndpoints();

    for (const endpoint of rpcEndpoints) {
      if (!this.rpcClients.has(endpoint.url)) {
        this.logger.debug(`Initializing RPC client for ${endpoint.name} (${endpoint.url})`);

        const client = new RpcRetryClient(endpoint.url, {
          maxRetries: PERFORMANCE.RPC_CLIENT.MAX_RETRY_ATTEMPTS,
          retryDelayMs: PERFORMANCE.RPC_CLIENT.RETRY_DELAY_MS,
          timeoutMs: PERFORMANCE.RPC_CLIENT.DEFAULT_TIMEOUT_MS,
        });

        this.rpcClients.set(endpoint.url, client);
      }
    }
  }

  /**
   * Get or create an RPC client for an endpoint
   */
  private getRpcClient(endpoint: RpcEndpoint): RpcRetryClient {
    if (!this.rpcClients.has(endpoint.url)) {
      this.logger.debug(`Creating new RPC client for ${endpoint.name} (${endpoint.url})`);

      const client = new RpcRetryClient(endpoint.url, {
        maxRetries: PERFORMANCE.RPC_CLIENT.MAX_RETRY_ATTEMPTS,
        retryDelayMs: PERFORMANCE.RPC_CLIENT.RETRY_DELAY_MS,
        timeoutMs: PERFORMANCE.RPC_CLIENT.DEFAULT_TIMEOUT_MS,
      });

      this.rpcClients.set(endpoint.url, client);
      return client;
    }

    return this.rpcClients.get(endpoint.url);
  }

  private initializeStatusMaps() {
    const rpcEndpoints = this.configService.getRpcEndpoints();
    const wsEndpoints = this.configService.getWsEndpoints();
    const explorerEndpoints = this.configService.explorerEndpoints;
    const faucetEndpoints = this.configService.faucetEndpoints;

    // Initialize or update RPC status map
    // First check if BlockchainService has already initialized these providers
    for (const endpoint of rpcEndpoints) {
      const provider = this.blockchainService.getProviderByUrl(endpoint.url);
      const providerStatus = provider ? 'up' : 'down';

      if (!this.rpcStatuses.has(endpoint.url)) {
        this.rpcStatuses.set(endpoint.url, { status: providerStatus, latency: 0 });
      } else {
        // Update existing status based on blockchain service provider
        const currentStatus = this.rpcStatuses.get(endpoint.url);
        currentStatus.status = providerStatus;
      }
    }

    // Initialize or update WebSocket status map
    if (WebSocket) {
      for (const endpoint of wsEndpoints) {
        const wsProvider = this.blockchainService.getWsProviderByUrl(endpoint.url);
        const wsStatus = wsProvider ? 'up' : 'down';

        if (!this.wsStatuses.has(endpoint.url)) {
          this.wsStatuses.set(endpoint.url, { status: wsStatus });
        } else {
          // Update existing status based on blockchain service ws provider
          const currentStatus = this.wsStatuses.get(endpoint.url);
          currentStatus.status = wsStatus;
        }
      }
    }

    for (const endpoint of explorerEndpoints) {
      this.explorerStatuses.set(endpoint.url, { status: 'down' });
    }

    for (const endpoint of faucetEndpoints) {
      this.faucetStatuses.set(endpoint.url, { status: 'down' });
    }
  }

  async monitorAllRpcEndpoints() {
    if (this.configService.enableRpcMonitoring !== true) {
      this.logger.debug('RPC monitoring is disabled via configuration. Skipping RPC check.');
      return;
    }

    this.logger.debug('Checking all RPC endpoints...');
    const endpoints = this.configService.getRpcEndpoints();

    const checkPromises = endpoints.map(async endpoint => {
      try {
        const isUp = await this.monitorRpcEndpoint(endpoint);

        if (isUp) {
          this.logger.debug(`RPC endpoint ${endpoint.name} (${endpoint.url}) is UP`);
        } else {
          this.logger.warn(`RPC endpoint ${endpoint.name} (${endpoint.url}) is DOWN`);
        }

        return { endpoint, isUp };
      } catch (error) {
        this.logger.error(`Error checking RPC endpoint ${endpoint.name}: ${error.message}`);
        return { endpoint, isUp: false };
      }
    });

    await Promise.all(checkPromises);
  }

  async monitorRpcEndpoint(endpoint: RpcEndpoint): Promise<boolean> {
    this.logger.debug(`Checking RPC endpoint: ${endpoint.name} (${endpoint.url})`);

    try {
      const startTime = Date.now();
      let blockNumber: number;
      let isUp = false;

      // First try using the BlockchainService's provider if available
      const provider = this.blockchainService.getProviderByUrl(endpoint.url);
      if (provider) {
        try {
          blockNumber = await provider.getBlockNumber();
          isUp = !isNaN(blockNumber);
        } catch (error) {
          this.logger.debug(`Provider from BlockchainService failed, trying direct RPC call: ${error.message}`);
          isUp = false;
        }
      }

      // If the provider is not available or failed, use RpcRetryClient as fallback
      if (!isUp) {
        const client = this.getRpcClient(endpoint);
        const blockNumberHex = await client.call<string>(
          BLOCKCHAIN.RPC.METHODS.GET_BLOCK_NUMBER,
          [],
          { timeoutMs: 5000 }, // Short timeout for monitoring
        );
        blockNumber = parseInt(blockNumberHex, 16);
        isUp = !isNaN(blockNumber);
      }

      const endTime = Date.now();
      const latency = endTime - startTime;

      // Update status and latency
      this.rpcStatuses.set(endpoint.url, { status: isUp ? 'up' : 'down', latency });

      // Inform BlockchainService about the provider status
      this.blockchainService.updateProviderStatus(endpoint.url, isUp);

      // Report metrics
      this.metricsService.setRpcStatus(endpoint.url, isUp, endpoint.chainId);
      this.metricsService.recordRpcLatency(endpoint.url, latency, endpoint.chainId);

      // Check for high latency - only error level alerts
      if (isUp && latency > ALERTS.THRESHOLDS.RPC_LATENCY_ERROR_MS) {
        this.alertsService.error(
          ALERTS.TYPES.RPC_HIGH_LATENCY,
          'rpc',
          `High RPC latency on ${endpoint.name}: ${latency}ms`,
        );
      }

      return isUp;
    } catch (error) {
      this.logger.warn(`RPC endpoint ${endpoint.name} is down: ${error.message}`);

      // Update status
      this.rpcStatuses.set(endpoint.url, { status: 'down', latency: 0 });

      // Inform BlockchainService about the provider failure
      this.blockchainService.updateProviderStatus(endpoint.url, false);

      // Report metrics
      this.metricsService.setRpcStatus(endpoint.url, false, endpoint.chainId);

      // Alert on RPC endpoint down
      this.alertsService.error(
        ALERTS.TYPES.RPC_ENDPOINT_DOWN,
        'rpc',
        `RPC endpoint ${endpoint.name} is not responding: ${error.message}`,
      );

      return false;
    }
  }

  async monitorAllRpcPorts() {
    if (!this.configService.enablePortMonitoring) {
      return;
    }

    this.logger.debug('Checking all RPC ports...');

    // Monitor all RPC endpoints regardless of enableMultiRpc setting
    for (const endpoint of this.configService.getRpcEndpoints()) {
      await this.monitorRpcPort(endpoint);
    }

    for (const endpoint of this.configService.getWsEndpoints()) {
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
      // First check if the BlockchainService already has a working connection
      const wsProvider = this.blockchainService.getWsProviderByUrl(endpoint.url);
      if (wsProvider) {
        // If the provider exists, update the status
        this.wsStatuses.set(endpoint.url, { status: 'up' });
        this.metricsService.setWebsocketStatus(endpoint.url, true, endpoint.chainId);
        this.logger.debug(`WebSocket connection to ${endpoint.name} is active in BlockchainService`);
        return;
      }

      if (!WebSocket) {
        this.logger.warn('WebSocket library not available. Skipping WebSocket monitoring.');
        return;
      }

      const wsUrl = endpoint.url;

      if (!wsUrl.startsWith('wss://') && !wsUrl.startsWith('ws://')) {
        this.logger.warn(`Invalid WebSocket URL for ${endpoint.name}: ${wsUrl} - Must start with ws:// or wss://`);
        this.wsStatuses.set(endpoint.url, { status: 'down' });
        this.metricsService.setWebsocketStatus(endpoint.url, false, endpoint.chainId);
        this.blockchainService.updateWsProviderStatus(endpoint.url, false);
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
          this.blockchainService.updateWsProviderStatus(endpoint.url, false);
          socket.terminate();
        }
      }, 5000);

      socket.on('open', () => {
        connectionSuccessful = true;
        this.logger.debug(`WebSocket connection to ${endpoint.name} successful`);
        this.wsStatuses.set(endpoint.url, { status: 'up' });
        this.metricsService.setWebsocketStatus(endpoint.url, true, endpoint.chainId);
        this.blockchainService.updateWsProviderStatus(endpoint.url, true);
        clearTimeout(timeout);
        socket.close();
      });

      socket.on('error', error => {
        this.logger.warn(`WebSocket connection error for ${endpoint.name}: ${error.message}`);
        this.wsStatuses.set(endpoint.url, { status: 'down' });
        this.metricsService.setWebsocketStatus(endpoint.url, false, endpoint.chainId);
        this.blockchainService.updateWsProviderStatus(endpoint.url, false);
        clearTimeout(timeout);

        if (!socket.terminated) {
          socket.terminate();
        }
      });
    } catch (error) {
      this.logger.error(`Error setting up WebSocket connection for ${endpoint.name}: ${error.message}`);
      this.wsStatuses.set(endpoint.url, { status: 'down' });
      this.metricsService.setWebsocketStatus(endpoint.url, false, endpoint.chainId);
      this.blockchainService.updateWsProviderStatus(endpoint.url, false);
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

    for (const endpoint of this.configService.getRpcEndpoints()) {
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

    for (const endpoint of this.configService.getWsEndpoints()) {
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

  /**
   * Sync status maps with the BlockchainService to ensure consistency
   * This helps avoid duplicate network calls and keeps monitoring aligned
   */
  private syncWithBlockchainService(): void {
    this.logger.debug('Syncing provider status with BlockchainService');

    // Sync HTTP RPC providers
    const allProviders = this.blockchainService.getAllProviders();
    for (const providerData of allProviders) {
      const { url, status } = providerData.endpoint;
      const currentStatus = this.rpcStatuses.get(url);

      if (currentStatus) {
        // Only update status, preserve latency
        currentStatus.status = status === 'up' ? 'up' : 'down';
      } else {
        this.rpcStatuses.set(url, { status: status === 'up' ? 'up' : 'down', latency: 0 });
      }
    }

    // Sync WebSocket providers
    const allWsProviders = this.blockchainService.getAllWsProviders();
    for (const wsProviderData of allWsProviders) {
      const { url, status } = wsProviderData.endpoint;
      const currentStatus = this.wsStatuses.get(url);

      if (currentStatus) {
        currentStatus.status = status === 'up' ? 'up' : 'down';
      } else {
        this.wsStatuses.set(url, { status: status === 'up' ? 'up' : 'down' });
      }

      // Update metrics
      this.metricsService.setWebsocketStatus(url, status === 'up', wsProviderData.endpoint.chainId);
    }
  }
}
