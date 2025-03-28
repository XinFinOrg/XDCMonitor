import { BlockchainService } from '@blockchain/blockchain.service';
import { ALERTS, BLOCKCHAIN, PERFORMANCE } from '@common/constants/config';
import { RpcRetryClient } from '@common/utils/rpc-retry-client';
import { ConfigService } from '@config/config.service';
import { MetricsService } from '@metrics/metrics.service';
import { AlertsService } from '@monitoring/alerts.service';
import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { RpcEndpoint, RpcStatus, ServiceStatus, WsStatus, RpcMonitorConfig, EndpointStatus, MonitorType } from '@types';
import axios from 'axios';
import WebSocket from 'ws';

// Downtime threshold for external notifications (1 hour in milliseconds)
const DOWNTIME_NOTIFICATION_THRESHOLD_MS = 60 * 60 * 1000; // 1 hour

// Default configuration
const DEFAULT_CONFIG: RpcMonitorConfig = {
  rpcInterval: 30000,
  portInterval: 30000,
  serviceInterval: 60000,
  wsInterval: 30000,
  syncInterval: 60000,
  rpcBatchSize: 3,
  wsBatchSize: 2,
  batchDelay: 500,
  adaptive: false,
  maxInterval: 120000, // 2 minutes
  minInterval: 15000, // 15 seconds
};

/**
 * Service for monitoring RPC endpoints, WebSockets, and related services
 */
@Injectable()
export class RpcMonitorService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RpcMonitorService.name);

  // Status tracking
  private rpcStatuses = new Map<string, EndpointStatus>();
  private wsStatuses = new Map<string, EndpointStatus>();
  private explorerStatuses = new Map<string, ServiceStatus>();
  private faucetStatuses = new Map<string, ServiceStatus>();
  private rpcClients = new Map<string, RpcRetryClient>();
  private intervals: Record<MonitorType, NodeJS.Timeout> = {} as any;

  // Configuration
  private config: RpcMonitorConfig = DEFAULT_CONFIG;

  constructor(
    private readonly blockchainService: BlockchainService,
    private readonly configService: ConfigService,
    private readonly metricsService: MetricsService,
    private readonly alertsService: AlertsService,
  ) {}

  // #region Lifecycle Methods

  /**
   * Initialize on module load
   */
  async onModuleInit() {
    await this.blockchainService.initializeProviders();
    if (this.configService.enableRpcMonitoring) {
      this.startMonitoring();
    } else {
      this.logger.log('RPC monitoring is disabled in configuration');
    }
  }

  /**
   * Stop monitoring when module is destroyed
   */
  onModuleDestroy() {
    this.stopMonitoring();
  }

  /**
   * Start monitoring all configured endpoints
   */
  startMonitoring() {
    this.initializeStatusMaps();
    this.initializeRpcClients();
    this.loadConfigSettings();

    this.logger.log(
      `Starting RPC monitoring with interval of ${this.config.rpcInterval / 1000}s${
        this.config.adaptive ? ' (adaptive)' : ''
      }`,
    );

    // Staggered monitoring initialization to prevent resource spikes
    this.scheduleMonitor('rpc', 0, () => this.monitorAllRpcEndpoints());
    this.scheduleMonitor('port', 5000, () => this.monitorAllRpcPorts());
    this.scheduleMonitor('service', 10000, () => this.monitorAllServices());
    this.scheduleMonitor('ws', 15000, () => this.monitorAllWsEndpoints());
    this.scheduleMonitor('sync', 20000, () => this.syncWithBlockchainService());
  }

  /**
   * Stop all monitoring activities
   */
  stopMonitoring() {
    this.logger.log('Stopping RPC monitoring');

    // Clear all intervals
    Object.values(this.intervals).forEach(interval => {
      if (interval) {
        clearInterval(interval);
        clearTimeout(interval);
      }
    });

    // Reset interval references
    this.intervals = {} as any;
  }

  /**
   * Load configuration settings from environment variables
   */
  private loadConfigSettings() {
    this.config = {
      rpcInterval: parseInt(this.configService.get('RPC_CHECK_INTERVAL_MS', '30000')),
      portInterval: parseInt(this.configService.get('PORT_CHECK_INTERVAL_MS', '30000')),
      serviceInterval: parseInt(this.configService.get('SERVICE_CHECK_INTERVAL_MS', '60000')),
      wsInterval: parseInt(this.configService.get('WS_CHECK_INTERVAL_MS', '30000')),
      syncInterval: parseInt(this.configService.get('SYNC_INTERVAL_MS', '60000')),
      rpcBatchSize: parseInt(this.configService.get('RPC_CHECK_BATCH_SIZE', '3')),
      wsBatchSize: parseInt(this.configService.get('WS_CHECK_BATCH_SIZE', '2')),
      batchDelay: parseInt(this.configService.get('BATCH_DELAY_MS', '500')),
      adaptive: this.configService.get('ENABLE_ADAPTIVE_MONITORING', 'false').toLowerCase() === 'true',
      maxInterval: parseInt(this.configService.get('MAX_CHECK_INTERVAL_MS', '120000')),
      minInterval: parseInt(this.configService.get('MIN_CHECK_INTERVAL_MS', '15000')),
    };
  }

  /**
   * Initialize status tracking maps
   */
  private initializeStatusMaps() {
    // Initialize RPC status map
    for (const endpoint of this.configService.getRpcEndpoints()) {
      this.initializeRpcStatus(endpoint);
    }

    // Initialize WebSocket status map
    if (WebSocket) {
      for (const endpoint of this.configService.getWsEndpoints()) {
        this.initializeWsStatus(endpoint);
      }
    }

    // Initialize explorer and faucet status maps
    this.initializeServiceStatuses();
  }

  /**
   * Initialize RPC endpoint status
   */
  private initializeRpcStatus(endpoint: RpcEndpoint): void {
    const provider = this.blockchainService.getProviderByUrl(endpoint.url);
    const status = provider ? 'up' : 'down';

    if (!this.rpcStatuses.has(endpoint.url)) {
      this.rpcStatuses.set(endpoint.url, {
        status,
        latency: 0,
        downSince: status === 'down' ? Date.now() : undefined,
        alerted: false,
      });
    } else {
      const currentStatus = this.rpcStatuses.get(endpoint.url);
      this.updateStatus(endpoint, this.rpcStatuses, status === 'up', {
        latency: currentStatus.latency,
      });
    }
  }

  /**
   * Initialize WebSocket endpoint status
   */
  private initializeWsStatus(endpoint: RpcEndpoint): void {
    const wsProvider = this.blockchainService.getWsProviderByUrl(endpoint.url);
    const status = wsProvider ? 'up' : 'down';

    if (!this.wsStatuses.has(endpoint.url)) {
      this.wsStatuses.set(endpoint.url, {
        status,
        downSince: status === 'down' ? Date.now() : undefined,
        alerted: false,
      });
    } else {
      this.updateStatus(endpoint, this.wsStatuses, status === 'up');
    }
  }

  /**
   * Initialize service statuses (explorers, faucets)
   */
  private initializeServiceStatuses(): void {
    // Initialize explorer statuses
    for (const endpoint of this.configService.explorerEndpoints) {
      this.explorerStatuses.set(endpoint.url, {
        status: 'down',
        downSince: Date.now(),
        alerted: false,
      });
    }

    // Initialize faucet statuses
    for (const endpoint of this.configService.faucetEndpoints) {
      this.faucetStatuses.set(endpoint.url, {
        status: 'down',
        downSince: Date.now(),
        alerted: false,
      });
    }
  }

  /**
   * Initialize RPC clients for all endpoints
   */
  private initializeRpcClients() {
    for (const endpoint of this.configService.getRpcEndpoints()) {
      this.getRpcClient(endpoint);
    }
  }

  /**
   * Get or create an RPC client for an endpoint
   */
  private getRpcClient(endpoint: RpcEndpoint): RpcRetryClient {
    if (!this.rpcClients.has(endpoint.url)) {
      this.logger.debug(`Creating RPC client for ${endpoint.name} (${endpoint.url})`);

      const client = new RpcRetryClient(endpoint.url, {
        maxRetries: PERFORMANCE.RPC_CLIENT.MAX_RETRY_ATTEMPTS,
        retryDelayMs: PERFORMANCE.RPC_CLIENT.RETRY_DELAY_MS,
        timeoutMs: PERFORMANCE.RPC_CLIENT.DEFAULT_TIMEOUT_MS,
      });

      this.rpcClients.set(endpoint.url, client);
    }

    return this.rpcClients.get(endpoint.url);
  }

  /**
   * Schedule a monitor function with initial delay
   */
  private scheduleMonitor(type: MonitorType, initialDelay: number, monitorFn: () => Promise<void> | void) {
    setTimeout(() => {
      // Initial check
      monitorFn();

      // Configure recurring check
      const interval = this.config[`${type}Interval`];

      if (this.config.adaptive && (type === 'rpc' || type === 'ws')) {
        this.scheduleAdaptiveCheck(type, interval, monitorFn);
      } else {
        this.intervals[type] = setInterval(monitorFn, interval);
      }
    }, initialDelay);
  }

  /**
   * Schedule adaptive monitoring based on endpoint health
   */
  private scheduleAdaptiveCheck(type: MonitorType, baseInterval: number, monitorFn: () => Promise<void> | void) {
    if (this.intervals[type]) {
      clearTimeout(this.intervals[type]);
    }

    // Calculate health factor and adjust interval
    const healthFactor = type === 'rpc' ? this.calculateRpcHealthFactor() : this.calculateWsHealthFactor();
    let nextInterval = baseInterval;

    if (healthFactor === 1) {
      // All endpoints healthy - check less frequently
      nextInterval = Math.min(baseInterval * 2, this.config.maxInterval);
    } else if (healthFactor < 0.8) {
      // Some endpoints unhealthy - check more frequently
      nextInterval = Math.max(baseInterval * 0.5, this.config.minInterval);
    }

    this.logger.debug(
      `Scheduled next ${type.toUpperCase()} check in ${nextInterval / 1000}s (health: ${healthFactor})`,
    );

    // Schedule next check
    this.intervals[type] = setTimeout(async () => {
      await monitorFn();
      this.scheduleAdaptiveCheck(type, baseInterval, monitorFn);
    }, nextInterval);
  }

  /**
   * Monitor all RPC endpoints
   */
  async monitorAllRpcEndpoints() {
    if (this.configService.enableRpcMonitoring !== true) {
      return;
    }

    this.logger.debug('Checking RPC endpoints...');
    await this.monitorEndpoints(
      this.configService.getRpcEndpoints(),
      this.rpcStatuses,
      this.config.rpcBatchSize,
      this.monitorRpcEndpoint.bind(this),
      (endpoint, isUp) =>
        !isUp && this.checkDowntimeNotification(endpoint, this.rpcStatuses, ALERTS.TYPES.RPC_ENDPOINT_DOWN, 'rpc'),
    );
  }

  /**
   * Monitor all WebSocket endpoints
   */
  async monitorAllWsEndpoints() {
    if (this.configService.get('ENABLE_WEBSOCKET_MONITORING', 'true') !== 'true' || !WebSocket) {
      return;
    }

    this.logger.debug('Checking WebSocket endpoints...');
    await this.monitorEndpoints(
      this.configService.getWsEndpoints(),
      this.wsStatuses,
      this.config.wsBatchSize,
      this.monitorWsEndpoint.bind(this),
      (endpoint, isUp) =>
        !isUp && this.checkDowntimeNotification(endpoint, this.wsStatuses, ALERTS.TYPES.RPC_ENDPOINT_DOWN, 'websocket'),
    );
  }

  /**
   * Generic endpoint monitoring with batching and prioritization
   */
  private async monitorEndpoints<T>(
    endpoints: RpcEndpoint[],
    statusMap: Map<string, T>,
    batchSize: number,
    checkFn: (endpoint: RpcEndpoint) => Promise<boolean>,
    postCheckFn?: (endpoint: RpcEndpoint, isUp: boolean) => void,
  ) {
    // Prioritize endpoints - down endpoints first, then conditional ones
    const prioritized = this.prioritizeEndpoints(endpoints, statusMap);

    // Process in batches
    for (let i = 0; i < prioritized.length; i += batchSize) {
      const batch = prioritized.slice(i, i + batchSize);
      const batchNumber = Math.floor(i / batchSize) + 1;
      const totalBatches = Math.ceil(prioritized.length / batchSize);

      this.logger.debug(`Processing endpoint batch ${batchNumber}/${totalBatches}`);

      // Process batch in parallel
      await Promise.all(
        batch.map(async endpoint => {
          try {
            // Determine the type of endpoint we're checking (RPC or WebSocket)
            const isWebSocket = endpoint.url.startsWith('ws://') || endpoint.url.startsWith('wss://');
            const endpointTypeStr = isWebSocket ? 'WebSocket' : 'RPC';

            let isUp = false;
            let latency = 0;

            // Use the appropriate checking method based on endpoint type
            if (isWebSocket) {
              // For WebSocket endpoints
              isUp = await this.testWebSocketConnection(endpoint);
            } else {
              // For HTTP RPC endpoints
              const startTime = Date.now();

              // Try provider first, then direct RPC call
              if (await this.tryBlockchainServiceProvider(endpoint)) {
                isUp = true;
              } else {
                isUp = await this.tryDirectRpcCall(endpoint);
              }

              latency = Date.now() - startTime;

              // Update RPC metrics including latency
              this.updateRpcEndpointStatus(endpoint, isUp, latency);

              // Check for latency thresholds (error and warning) for RPC only
              if (isUp && latency > ALERTS.THRESHOLDS.RPC_LATENCY_WARNING_MS) {
                const isError = latency > ALERTS.THRESHOLDS.RPC_LATENCY_ERROR_MS;
                this.alertsService[isError ? 'error' : 'warning'](
                  ALERTS.TYPES.RPC_HIGH_LATENCY,
                  'rpc',
                  `${isError ? 'High' : 'Elevated'} RPC latency on ${endpoint.name}: ${latency}ms`,
                  endpoint.chainId,
                );
              }
            }

            this.logger.debug(`${endpointTypeStr} endpoint ${endpoint.name} is ${isUp ? 'UP' : 'DOWN'}`);
            if (!isUp && postCheckFn) postCheckFn(endpoint, isUp);

            // For WebSocket endpoints, update the WebSocket specific status
            if (isWebSocket) {
              this.updateStatus(endpoint, this.wsStatuses, isUp);
              this.metricsService.setWebsocketStatus(endpoint.url, isUp, endpoint.chainId);
              this.blockchainService.updateWsProviderStatus(endpoint.url, isUp);
            }

            return { endpoint, isUp };
          } catch (error) {
            this.logger.error(`Error checking endpoint ${endpoint.name}: ${error.message}`);
            if (postCheckFn) postCheckFn(endpoint, false);
            return { endpoint, isUp: false };
          }
        }),
      );

      // Small delay between batches to avoid overwhelming the network
      if (i + batchSize < prioritized.length) {
        await new Promise(resolve => setTimeout(resolve, this.config.batchDelay));
      }
    }
  }

  /**
   * Prioritize endpoints for checking (down first, then conditional)
   */
  private prioritizeEndpoints(endpoints: RpcEndpoint[], statusMap: Map<string, any>): RpcEndpoint[] {
    return [...endpoints].sort((a, b) => {
      // First prioritize by status (down first)
      const statusA = statusMap.get(a.url)?.['status'] || 'unknown';
      const statusB = statusMap.get(b.url)?.['status'] || 'unknown';

      if (statusA === 'down' && statusB !== 'down') return -1;
      if (statusA !== 'down' && statusB === 'down') return 1;

      // Then by conditional flag if applicable
      if ('conditional' in a && 'conditional' in b) {
        if (a.conditional !== b.conditional) {
          return a.conditional ? 1 : -1;
        }
      }

      return 0;
    });
  }

  /**
   * Monitor a specific RPC endpoint (HTTP only, not WebSocket)
   */
  async monitorRpcEndpoint(endpoint: RpcEndpoint): Promise<boolean> {
    // Verify this is a HTTP endpoint, not a WebSocket
    if (endpoint.url.startsWith('ws://') || endpoint.url.startsWith('wss://')) {
      this.logger.warn(`Attempted to monitor WebSocket endpoint ${endpoint.name} with RPC monitor`);
      return false;
    }

    try {
      const startTime = Date.now();
      let isUp = false;

      // First try using BlockchainService's provider
      if (await this.tryBlockchainServiceProvider(endpoint)) {
        isUp = true;
      } else {
        // If provider failed, use RpcRetryClient
        isUp = await this.tryDirectRpcCall(endpoint);
      }

      const latency = Date.now() - startTime;

      // Update status and metrics for RPC (HTTP) endpoint
      this.updateRpcEndpointStatus(endpoint, isUp, latency);

      // Check for latency thresholds
      if (isUp) {
        if (latency > ALERTS.THRESHOLDS.RPC_LATENCY_ERROR_MS) {
          this.alertsService.error(
            ALERTS.TYPES.RPC_HIGH_LATENCY,
            'rpc',
            `High RPC latency on ${endpoint.name}: ${latency}ms`,
            endpoint.chainId,
          );
        } else if (latency > ALERTS.THRESHOLDS.RPC_LATENCY_WARNING_MS) {
          this.alertsService.warning(
            ALERTS.TYPES.RPC_HIGH_LATENCY,
            'rpc',
            `Elevated RPC latency on ${endpoint.name}: ${latency}ms`,
            endpoint.chainId,
          );
        }
      }

      return isUp;
    } catch (error) {
      this.logger.warn(`RPC endpoint ${endpoint.name} is down: ${error.message}`);
      this.updateRpcEndpointStatus(endpoint, false, 0);
      return false;
    }
  }

  /**
   * Try checking RPC using BlockchainService provider
   */
  private async tryBlockchainServiceProvider(endpoint: RpcEndpoint): Promise<boolean> {
    const provider = this.blockchainService.getProviderByUrl(endpoint.url);
    if (!provider) return false;

    try {
      const blockNumber = await provider.getBlockNumber();
      return !isNaN(blockNumber);
    } catch (error) {
      this.logger.debug(`Provider failed, trying direct RPC: ${error.message}`);
      return false;
    }
  }

  /**
   * Try making a direct RPC call
   */
  private async tryDirectRpcCall(endpoint: RpcEndpoint): Promise<boolean> {
    try {
      const client = this.getRpcClient(endpoint);
      const blockNumberHex = await client.call<string>(BLOCKCHAIN.RPC.METHODS.GET_BLOCK_NUMBER, [], {
        timeoutMs: 5000,
      });
      const blockNumber = parseInt(blockNumberHex, 16);
      return !isNaN(blockNumber);
    } catch (error) {
      return false;
    }
  }

  /**
   * Update RPC endpoint status and metrics (for HTTP RPC endpoints only)
   */
  private updateRpcEndpointStatus(endpoint: RpcEndpoint, isUp: boolean, latency: number): void {
    // Verify this is an HTTP endpoint
    if (endpoint.url.startsWith('ws://') || endpoint.url.startsWith('wss://')) {
      this.logger.warn(`Attempted to update WebSocket endpoint ${endpoint.name} status using RPC status method`);
      return;
    }

    // Update status in RPC statuses map only (not WebSocket statuses)
    const current = this.updateStatus(endpoint, this.rpcStatuses, isUp, { latency });

    // Update provider status and metrics for HTTP RPC
    this.blockchainService.updateProviderStatus(endpoint.url, isUp);
    this.metricsService.setRpcStatus(endpoint.url, isUp, endpoint.chainId);
    this.metricsService.recordRpcLatency(endpoint.url, latency, endpoint.chainId);

    // Check for downtime alerts
    if (!isUp) {
      this.checkDowntimeNotification(endpoint, this.rpcStatuses, ALERTS.TYPES.RPC_ENDPOINT_DOWN, 'rpc');
    }
  }

  /**
   * Monitor a WebSocket endpoint
   */
  async monitorWsEndpoint(endpoint: RpcEndpoint): Promise<boolean> {
    // Verify this is a WebSocket endpoint
    if (!endpoint.url.startsWith('ws://') && !endpoint.url.startsWith('wss://')) {
      this.logger.warn(`Attempted to monitor HTTP endpoint ${endpoint.name} with WebSocket monitor`);
      return false;
    }

    try {
      // First check if already active in BlockchainService
      const wsProvider = this.blockchainService.getWsProviderByUrl(endpoint.url);

      if (wsProvider) {
        // Update WebSocket status only
        this.updateStatus(endpoint, this.wsStatuses, true);
        this.metricsService.setWebsocketStatus(endpoint.url, true, endpoint.chainId);
        return true;
      }

      // Attempt direct WebSocket connection
      return await this.testWebSocketConnection(endpoint);
    } catch (error) {
      this.logger.error(`Error monitoring WebSocket endpoint ${endpoint.name}: ${error.message}`);
      // Update WebSocket status only
      this.updateStatus(endpoint, this.wsStatuses, false);
      this.metricsService.setWebsocketStatus(endpoint.url, false, endpoint.chainId);
      return false;
    }
  }

  /**
   * Test a WebSocket connection
   */
  private testWebSocketConnection(endpoint: RpcEndpoint): Promise<boolean> {
    return new Promise(resolve => {
      try {
        // Validate URL
        if (!endpoint.url.startsWith('ws://') && !endpoint.url.startsWith('wss://')) {
          this.logger.warn(`Invalid WebSocket URL: ${endpoint.url}`);
          this.updateStatus(endpoint, this.wsStatuses, false);
          this.metricsService.setWebsocketStatus(endpoint.url, false, endpoint.chainId);
          resolve(false);
          return;
        }

        // Create connection
        const socket = new WebSocket(endpoint.url, {
          handshakeTimeout: 5000,
          followRedirects: true,
        });

        let connectionSuccessful = false;

        // Set timeout for connection
        const timeout = setTimeout(() => {
          if (!connectionSuccessful) {
            this.handleWsConnectionFailure(endpoint, socket, 'Connection timed out');
            resolve(false);
          }
        }, 5000);

        // Handle successful connection
        socket.on('open', () => {
          connectionSuccessful = true;
          clearTimeout(timeout);

          this.logger.debug(`WebSocket connection to ${endpoint.name} successful`);
          this.updateStatus(endpoint, this.wsStatuses, true);
          this.metricsService.setWebsocketStatus(endpoint.url, true, endpoint.chainId);
          this.blockchainService.updateWsProviderStatus(endpoint.url, true);

          socket.close();
          resolve(true);
        });

        // Handle connection errors
        socket.on('error', error => {
          this.logger.warn(`WebSocket connection error for ${endpoint.name}: ${error.message}`);
          this.handleWsConnectionFailure(endpoint, socket, error.message);
          clearTimeout(timeout);
          resolve(false);
        });
      } catch (error) {
        this.logger.error(`Error setting up WebSocket connection for ${endpoint.name}: ${error.message}`);
        this.updateStatus(endpoint, this.wsStatuses, false);
        this.metricsService.setWebsocketStatus(endpoint.url, false, endpoint.chainId);
        resolve(false);
      }
    });
  }

  /**
   * Handle WebSocket connection failure
   */
  private handleWsConnectionFailure(endpoint: RpcEndpoint, socket: WebSocket, reason: string) {
    this.updateStatus(endpoint, this.wsStatuses, false);
    this.metricsService.setWebsocketStatus(endpoint.url, false, endpoint.chainId);
    this.blockchainService.updateWsProviderStatus(endpoint.url, false);

    try {
      socket.terminate();
    } catch (e) {
      // Ignore termination errors
    }
  }

  /**
   * Monitor all RPC and WebSocket ports
   */
  async monitorAllRpcPorts() {
    if (!this.configService.enablePortMonitoring) {
      return;
    }

    this.logger.debug('Checking ports...');

    // Process in parallel
    await Promise.all([
      Promise.all(this.configService.getRpcEndpoints().map(e => this.monitorRpcPort(e))),
      Promise.all(this.configService.getWsEndpoints().map(e => this.monitorWsPort(e))),
    ]);
  }

  /**
   * Monitor an RPC port
   */
  async monitorRpcPort(endpoint: RpcEndpoint) {
    try {
      const rpcUrl = new URL(endpoint.url);
      const domain = rpcUrl.hostname;
      const port = rpcUrl.port || (rpcUrl.protocol === 'https:' ? '443' : '80');

      try {
        await axios.get(`${rpcUrl.protocol}//${domain}:${port}`, { timeout: 5000 });
        this.logger.debug(`RPC port ${port} is open for ${endpoint.name}`);
      } catch (error) {
        if (error.code === 'ECONNREFUSED') {
          this.logger.warn(`RPC port ${port} is closed for ${endpoint.name}`);
        } else {
          this.logger.debug(`RPC port check for ${endpoint.name}: ${error.message}`);
        }
      }
    } catch (error) {
      this.logger.error(`Error monitoring port for ${endpoint.name}: ${error.message}`);
    }
  }

  /**
   * Monitor a WebSocket port
   */
  async monitorWsPort(endpoint: RpcEndpoint) {
    try {
      const wsUrl = new URL(endpoint.url);
      const domain = wsUrl.hostname;
      const port = wsUrl.port || (wsUrl.protocol === 'wss:' ? '443' : '80');

      this.logger.debug(`Checking WebSocket port ${port} for ${endpoint.name}`);

      // For WebSockets, we rely on the WebSocket connection test
      const isUp = await this.testWebSocketConnection(endpoint);
      if (isUp) {
        this.logger.debug(`WebSocket port ${port} is open for ${endpoint.name}`);
      } else {
        this.logger.warn(`WebSocket port ${port} is closed or unreachable for ${endpoint.name}`);
      }
    } catch (error) {
      this.logger.error(`Error monitoring WebSocket port for ${endpoint.name}: ${error.message}`);
    }
  }

  /**
   * Monitor all services (explorers, faucets)
   */
  async monitorAllServices() {
    if (!this.configService.enableRpcMonitoring) {
      return;
    }

    this.logger.debug('Checking services...');

    // Monitor explorers
    if (this.configService.explorerEndpoints?.length) {
      await this.monitorServiceGroup(this.configService.explorerEndpoints, 'explorer');
    }

    // Monitor faucets
    if (this.configService.faucetEndpoints?.length) {
      await this.monitorServiceGroup(this.configService.faucetEndpoints, 'faucet');
    }
  }

  /**
   * Monitor a group of services
   */
  private async monitorServiceGroup(endpoints: RpcEndpoint[], serviceType: string) {
    const results = await Promise.all(endpoints.map(endpoint => this.monitorService(endpoint)));
    const upCount = results.filter(Boolean).length;
    this.logger.debug(`${serviceType} check: ${upCount}/${results.length} ${serviceType}s available`);
  }

  /**
   * Monitor a service endpoint
   */
  async monitorService(endpoint: RpcEndpoint): Promise<boolean> {
    try {
      this.logger.debug(`Checking service: ${endpoint.name} (${endpoint.url})`);

      const response = await axios.get(endpoint.url, {
        timeout: 5000,
        validateStatus: null,
      });

      const isUp = response.status >= 200 && response.status < 500;
      this.updateServiceStatus(endpoint, isUp);

      this.logger.debug(`Service ${endpoint.name} is ${isUp ? 'UP' : 'DOWN'}`);
      return isUp;
    } catch (error) {
      this.logger.debug(`Service ${endpoint.name} check failed: ${error.message}`);
      this.updateServiceStatus(endpoint, false);
      return false;
    }
  }

  /**
   * Update service status and metrics
   */
  private updateServiceStatus(endpoint: RpcEndpoint, isUp: boolean): void {
    if (endpoint.url.includes('explorer') || endpoint.url.includes('scan')) {
      this.explorerStatuses.set(endpoint.url, { status: isUp ? 'up' : 'down' });
      this.metricsService.setExplorerStatus(endpoint.url, isUp, endpoint.chainId);
    } else if (endpoint.url.includes('faucet')) {
      this.faucetStatuses.set(endpoint.url, { status: isUp ? 'up' : 'down' });
      this.metricsService.setFaucetStatus(endpoint.url, isUp, endpoint.chainId);
    }
  }

  /**
   * Sync with blockchain service to ensure consistency
   */
  private syncWithBlockchainService(): void {
    this.logger.debug('Syncing provider status with BlockchainService');

    // Sync HTTP RPC providers
    for (const { endpoint } of this.blockchainService.getAllProviders()) {
      const { url, status } = endpoint;
      const currentStatus = this.rpcStatuses.get(url);

      if (currentStatus) {
        currentStatus.status = status === 'up' ? 'up' : 'down';
      } else {
        this.rpcStatuses.set(url, { status: status === 'up' ? 'up' : 'down', latency: 0, alerted: false });
      }
    }

    // Sync WebSocket providers
    for (const { endpoint } of this.blockchainService.getAllWsProviders()) {
      const { url, status, chainId } = endpoint;

      // Use updateStatus method to properly maintain downSince and alerted properties
      const wsEndpoint = this.configService.getWsEndpoints().find(e => e.url === url);
      if (wsEndpoint) {
        const isUp = status === 'up';
        this.updateStatus(wsEndpoint, this.wsStatuses, isUp);

        // Check for downtime notifications for WebSocket endpoints
        if (!isUp) {
          this.checkDowntimeNotification(wsEndpoint, this.wsStatuses, ALERTS.TYPES.RPC_ENDPOINT_DOWN, 'websocket');
        }
      } else {
        const currentStatus = this.wsStatuses.get(url);
        if (currentStatus) {
          currentStatus.status = status === 'up' ? 'up' : 'down';
        } else {
          this.wsStatuses.set(url, { status: status === 'up' ? 'up' : 'down', alerted: false });
        }
      }

      this.metricsService.setWebsocketStatus(url, status === 'up', chainId);
    }
  }

  /**
   * Update status for any endpoint type
   */
  private updateStatus(endpoint: RpcEndpoint, statusMap: Map<string, any>, isUp: boolean, extraFields = {}) {
    // Get current status
    const current = statusMap.get(endpoint.url) || {
      status: 'unknown',
      downSince: undefined,
      alerted: false,
      ...extraFields,
    };

    // Handle status transitions
    if (!isUp && current.status !== 'down') {
      // Status changed to down - record when it happened
      current.downSince = Date.now();
      current.alerted = false;
    } else if (isUp && current.status === 'down') {
      // Status changed to up - clear downtime tracking
      current.downSince = undefined;
      current.alerted = false;
    }

    // Update status
    statusMap.set(endpoint.url, {
      ...current,
      status: isUp ? 'up' : 'down',
      ...extraFields,
    });

    return current;
  }

  /**
   * Check if we should send a notification for extended downtime
   */
  private checkDowntimeNotification(
    endpoint: RpcEndpoint,
    statusMap: Map<string, any>,
    alertType: string,
    endpointType: string,
  ): boolean {
    const status = statusMap.get(endpoint.url);
    if (!status?.downSince || status.alerted) return false;

    const currentTime = Date.now();
    const isDownLongEnough = currentTime - status.downSince >= DOWNTIME_NOTIFICATION_THRESHOLD_MS;

    if (isDownLongEnough) {
      // Calculate downtime for message
      const downtimeMs = currentTime - status.downSince;
      const hours = Math.floor(downtimeMs / (60 * 60 * 1000));
      const minutes = Math.floor((downtimeMs % (60 * 60 * 1000)) / (60 * 1000));

      // Send alert
      this.alertsService.error(
        alertType,
        endpointType,
        `${endpointType.charAt(0).toUpperCase() + endpointType.slice(1)} endpoint ${endpoint.name} - ${endpoint.url} has been down for ${hours}h ${minutes}m`,
        endpoint.chainId,
      );

      // Mark as alerted
      status.alerted = true;
      return true;
    }

    return false;
  }

  /**
   * Calculate health factor for a status map (0-1)
   */
  private calculateHealthFactor(statusMap: Map<string, any>, endpoints: RpcEndpoint[]): number {
    if (!endpoints.length) return 1;
    const healthyCount = endpoints.filter(e => statusMap.get(e.url)?.status === 'up').length;
    return healthyCount / endpoints.length;
  }

  /**
   * Calculate health factor for RPC endpoints
   */
  private calculateRpcHealthFactor(): number {
    return this.calculateHealthFactor(this.rpcStatuses, this.configService.getRpcEndpoints());
  }

  /**
   * Calculate health factor for WebSocket endpoints
   */
  private calculateWsHealthFactor(): number {
    return this.calculateHealthFactor(this.wsStatuses, this.configService.getWsEndpoints());
  }

  /**
   * Get all RPC endpoint statuses
   */
  getAllRpcStatuses() {
    return this.configService.getRpcEndpoints().map(endpoint => {
      const status = this.rpcStatuses.get(endpoint.url) || { status: 'unknown', latency: 0 };
      return {
        name: endpoint.name,
        url: endpoint.url,
        type: endpoint.type,
        status: status.status,
        latency: status.latency,
        chainId: endpoint.chainId,
      };
    });
  }

  /**
   * Get all WebSocket endpoint statuses
   */
  getAllWsStatuses() {
    return this.configService.getWsEndpoints().map(endpoint => {
      const status = this.wsStatuses.get(endpoint.url) || { status: 'unknown' };
      return {
        name: endpoint.name,
        url: endpoint.url,
        type: endpoint.type,
        status: status.status,
        chainId: endpoint.chainId,
      };
    });
  }

  /**
   * Get all explorer statuses
   */
  getAllExplorerStatuses() {
    return Object.fromEntries([...this.explorerStatuses.entries()].map(([url, status]) => [url, status.status]));
  }

  /**
   * Get all faucet statuses
   */
  getAllFaucetStatuses() {
    return Object.fromEntries([...this.faucetStatuses.entries()].map(([url, status]) => [url, status.status]));
  }

  /**
   * Get the overall WebSocket status
   */
  getAnyWsStatus(): 'up' | 'down' {
    return [...this.wsStatuses.values()].some(status => status.status === 'up') ? 'up' : 'down';
  }
}
