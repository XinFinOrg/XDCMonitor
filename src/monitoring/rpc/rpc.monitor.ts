import { AlertService } from '@alerts/alert.service';
import { BlockchainService } from '@blockchain/blockchain.service';
import { ALERTS, BLOCKCHAIN, PERFORMANCE } from '@common/constants/config';
import { RpcRetryClient } from '@common/utils/rpc-retry-client';
import { ConfigService } from '@config/config.service';
import { MetricsService } from '@metrics/metrics.service';
import { PeerCountMonitor } from '@monitoring/rpc/peer-count.monitor';
import { RpcSelectorService } from '@monitoring/rpc/rpc-selector.service';
import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { EndpointStatus, MonitorType, RpcEndpoint, RpcMonitorConfig, ServiceStatus } from '@types';
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

  // Configuration settings
  private config: RpcMonitorConfig = DEFAULT_CONFIG;

  constructor(
    private readonly blockchainService: BlockchainService,
    private readonly configService: ConfigService,
    private readonly metricsService: MetricsService,
    private readonly alertService: AlertService,
    private readonly peerCountMonitor: PeerCountMonitor,
    private readonly rpcSelectorService: RpcSelectorService,
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
    this.scheduleMonitor('ws', 0, () => this.monitorAllWsEndpoints());
    this.scheduleMonitor('port', 5000, () => this.monitorAllRpcPorts());
    this.scheduleMonitor('service', 10000, () => this.monitorAllServices());
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
        !isUp &&
        this.checkDowntimeNotification(
          endpoint,
          this.rpcStatuses,
          ALERTS.TYPES.RPC_ENDPOINT_DOWN,
          ALERTS.COMPONENTS.RPC,
        ),
    );
  }

  /**
   * Monitor all WebSocket endpoints
   */
  async monitorAllWsEndpoints() {
    if (this.configService.enableRpcMonitoring !== true) {
      return;
    }

    this.logger.debug('Checking WebSocket endpoints...');
    await this.monitorEndpoints(
      this.configService.getWsEndpoints(),
      this.wsStatuses,
      this.config.wsBatchSize,
      this.monitorWsEndpoint.bind(this),
      (endpoint, isUp) => {
        if (!isUp) {
          // Ensure downtime is properly tracked before attempting notification
          const status = this.wsStatuses.get(endpoint.url);
          if (!status?.downSince) {
            this.updateStatus(endpoint, this.wsStatuses, false);
          }
          return this.checkDowntimeNotification(
            endpoint,
            this.wsStatuses,
            ALERTS.TYPES.RPC_ENDPOINT_DOWN,
            ALERTS.COMPONENTS.WEBSOCKET,
          );
        }
        return false;
      },
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

      // Process batch in parallel with individual error handling for each endpoint
      await Promise.all(
        batch.map(async endpoint => {
          try {
            // Determine the type of endpoint we're checking (RPC or WebSocket)
            const isWebSocket = this.isWebSocketEndpoint(endpoint);
            const endpointTypeStr = isWebSocket ? 'WebSocket' : 'RPC';

            // Use the provided check function to check this endpoint
            const isUp = await checkFn(endpoint);

            this.logger.debug(
              `${endpointTypeStr} endpoint ( ${endpoint.url} ) for chain ${endpoint.chainId} is ${isUp ? 'UP' : 'DOWN'}`,
            );

            // If down and postCheckFn provided, call it
            if (!isUp && postCheckFn) postCheckFn(endpoint, isUp);

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
   * Check if an endpoint is a WebSocket endpoint
   */
  private isWebSocketEndpoint(endpoint: RpcEndpoint): boolean {
    return endpoint.url.startsWith('ws://') || endpoint.url.startsWith('wss://');
  }

  /**
   * Monitor a specific RPC endpoint (HTTP only, not WebSocket)
   */
  async monitorRpcEndpoint(endpoint: RpcEndpoint): Promise<boolean> {
    // Verify this is a HTTP endpoint, not a WebSocket
    if (this.isWebSocketEndpoint(endpoint)) {
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
          this.alertService.error(
            ALERTS.TYPES.RPC_HIGH_LATENCY,
            ALERTS.COMPONENTS.RPC,
            `High RPC latency on ${endpoint.url} for chain ${endpoint.chainId} is :  ${latency / 1000}s`,
            endpoint.chainId,
          );
        } else if (latency > ALERTS.THRESHOLDS.RPC_LATENCY_WARNING_MS) {
          this.alertService.warning(
            ALERTS.TYPES.RPC_HIGH_LATENCY,
            ALERTS.COMPONENTS.RPC,
            `Elevated RPC latency on ${endpoint.url} for chain ${endpoint.chainId} is :  ${latency / 1000}s`,
            endpoint.chainId,
          );
        }
      }

      return isUp;
    } catch (error) {
      this.logger.warn(`RPC endpoint ( ${endpoint.url} ) for chain ${endpoint.chainId} is down: ${error.message}`);
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
  private async updateRpcEndpointStatus(endpoint: RpcEndpoint, isUp: boolean, latency: number): Promise<void> {
    this.updateStatus(endpoint, this.rpcStatuses, isUp, { latency });
    this.metricsService.setRpcStatus(endpoint.url, isUp, endpoint.chainId);
    this.metricsService.recordRpcLatency(endpoint.url, latency, endpoint.chainId);

    // Update RPC selector service with this endpoint's health
    this.rpcSelectorService.updateEndpointHealth(endpoint, isUp, latency);

    // If endpoint is up, check peer count; otherwise check for downtime
    if (isUp) {
      this.monitorRpcPeerCount(endpoint);
    } else {
      this.checkDowntimeNotification(endpoint, this.rpcStatuses, ALERTS.TYPES.RPC_ENDPOINT_DOWN, ALERTS.COMPONENTS.RPC);
    }
  }

  /**
   * Monitor peer count for any endpoint with improved error handling
   */
  private monitorPeerCount(endpoint: RpcEndpoint, isWebSocket: boolean): void {
    const endpointType = isWebSocket ? 'WebSocket' : 'RPC';
    const monitorFn = isWebSocket
      ? this.peerCountMonitor.monitorWsPeerCount.bind(this.peerCountMonitor)
      : this.peerCountMonitor.monitorRpcPeerCount.bind(this.peerCountMonitor);

    try {
      // Make sure we don't have any issues blocking the entire monitoring process
      Promise.resolve().then(async () => {
        try {
          await monitorFn(endpoint);
          this.logger.debug(`Successfully monitored ${endpointType} peer count for ${endpoint.url}`);
        } catch (error) {
          this.logger.debug(`Failed to monitor peer count for ${endpointType} ${endpoint.url}: ${error.message}`);
        }
      });
    } catch (error) {
      this.logger.debug(`Error setting up ${endpointType} peer count monitoring for ${endpoint.url}: ${error.message}`);
    }
  }

  /**
   * Monitor peer count for an RPC endpoint
   */
  private monitorRpcPeerCount(endpoint: RpcEndpoint): void {
    this.monitorPeerCount(endpoint, false);
  }

  /**
   * Monitor peer count for a WebSocket endpoint
   */
  private monitorWsPeerCount(endpoint: RpcEndpoint): void {
    this.monitorPeerCount(endpoint, true);
  }

  /**
   * Monitor a WebSocket endpoint
   */
  async monitorWsEndpoint(endpoint: RpcEndpoint): Promise<boolean> {
    // Verify this is a WebSocket endpoint
    if (!this.isWebSocketEndpoint(endpoint)) {
      this.logger.warn(`Attempted to monitor HTTP endpoint ${endpoint.name} with WebSocket monitor`);
      return false;
    }

    try {
      let isUp = false;

      // First check if already active in BlockchainService
      const wsProvider = this.blockchainService.getWsProviderByUrl(endpoint.url);
      if (wsProvider) {
        isUp = true;
      } else {
        // Attempt direct WebSocket connection
        isUp = await this.testWebSocketConnection(endpoint);
        // BlockchainService status is already updated within testWebSocketConnection
      }

      // If WebSocket is up, check peer count; otherwise check for downtime alerts
      if (isUp) {
        this.monitorWsPeerCount(endpoint);
      } else {
        this.checkDowntimeNotification(
          endpoint,
          this.wsStatuses,
          ALERTS.TYPES.RPC_ENDPOINT_DOWN,
          ALERTS.COMPONENTS.WEBSOCKET,
        );
      }

      return isUp;
    } catch (error) {
      this.logger.error(`Error monitoring WebSocket endpoint ${endpoint.name}: ${error.message}`);

      // Update status to down
      this.updateStatus(endpoint, this.wsStatuses, false);
      this.metricsService.setWebsocketStatus(endpoint.url, false, endpoint.chainId);
      this.blockchainService.updateWsProviderStatus(endpoint.url, false);

      // Check for downtime notification
      this.checkDowntimeNotification(
        endpoint,
        this.wsStatuses,
        ALERTS.TYPES.RPC_ENDPOINT_DOWN,
        ALERTS.COMPONENTS.WEBSOCKET,
      );

      return false;
    }
  }

  // Original monitorWsPeerCount implementation removed - using common implementation from above

  /**
   * Test a WebSocket connection
   *
   * Optimized with better error handling and cleanup to prevent memory leaks
   */
  private testWebSocketConnection(endpoint: RpcEndpoint): Promise<boolean> {
    return new Promise(resolve => {
      try {
        // Validate URL
        if (!this.isWebSocketEndpoint(endpoint)) {
          this.logger.warn(`Invalid WebSocket URL: ${endpoint.url}`);
          this.handleWsConnectionFailure(endpoint, null, 'Invalid WebSocket URL');
          resolve(false);
          return;
        }

        // Create connection with timeout
        const socket = new WebSocket(endpoint.url, {
          handshakeTimeout: 5000,
          followRedirects: true,
        });

        let resolved = false;

        // Helper function to prevent multiple resolves and handle cleanup
        const safeResolve = (success: boolean, reason: string = '') => {
          if (resolved) return;

          resolved = true;

          // Update statuses based on connection result
          if (success) {
            this.updateStatus(endpoint, this.wsStatuses, true);
            this.metricsService.setWebsocketStatus(endpoint.url, true, endpoint.chainId);
            this.blockchainService.updateWsProviderStatus(endpoint.url, true);
          } else {
            this.handleWsConnectionFailure(endpoint, socket, reason || 'Connection failed');
          }

          resolve(success);
        };

        // Set timeout for connection
        const timeout = setTimeout(() => {
          this.logger.warn(`WebSocket connection timeout for ${endpoint.name}`);
          safeResolve(false, 'Connection timeout');
        }, 5000);

        // Handle successful connection
        socket.on('open', () => {
          this.logger.debug(`WebSocket connection to ${endpoint.name} successful`);
          clearTimeout(timeout);
          safeResolve(true);

          // Clean close of the socket
          try {
            socket.close(1000, 'Normal closure');
          } catch (e) {
            // Ignore error on close
          }
        });

        // Handle connection errors
        socket.on('error', error => {
          this.logger.warn(`WebSocket connection error for ${endpoint.name}: ${error.message}`);
          clearTimeout(timeout);
          safeResolve(false, error.message);
        });

        // Handle connection close
        socket.on('close', () => {
          this.logger.debug(`WebSocket connection to ${endpoint.name} closed`);
          clearTimeout(timeout);
          if (!resolved) {
            // If we get here without resolution, the connection closed unexpectedly
            safeResolve(false, 'Connection closed unexpectedly');
          }
        });
      } catch (error) {
        this.logger.error(`Error setting up WebSocket connection for ${endpoint.name}: ${error.message}`);
        this.handleWsConnectionFailure(endpoint, null, error.message);
        resolve(false);
      }
    });
  }

  /**
   * Handle WebSocket connection failure
   */
  private handleWsConnectionFailure(endpoint: RpcEndpoint, socket: WebSocket | null, reason: string) {
    this.updateStatus(endpoint, this.wsStatuses, false);
    this.metricsService.setWebsocketStatus(endpoint.url, false, endpoint.chainId);
    this.blockchainService.updateWsProviderStatus(endpoint.url, false);

    if (socket) {
      try {
        socket.terminate();
      } catch (e) {
        // Ignore termination errors
      }
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
   * Helper function to parse URL for port monitoring
   */
  private parseEndpointUrl(endpoint: RpcEndpoint): { url: URL; domain: string; port: string } {
    const url = new URL(endpoint.url);
    const domain = url.hostname;
    const isHttps = url.protocol === 'https:' || url.protocol === 'wss:';
    const port = url.port || (isHttps ? '443' : '80');

    return { url, domain, port };
  }

  /**
   * Monitor an RPC port
   */
  async monitorRpcPort(endpoint: RpcEndpoint) {
    try {
      const { url, domain, port } = this.parseEndpointUrl(endpoint);

      try {
        await axios.get(`${url.protocol}//${domain}:${port}`, { timeout: 5000 });
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
      const { port } = this.parseEndpointUrl(endpoint);
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
   * Sync with BlockchainService to check for endpoints behind in block height
   */
  private syncWithBlockchainService(): void {
    this.logger.debug('Syncing provider status with BlockchainService');

    // We'll need to manually get block heights for each provider
    this.checkProviderBlockHeights();

    // First pass: sync HTTP RPC providers
    for (const providerData of this.blockchainService.getAllProviders()) {
      const { url, status, chainId } = providerData.endpoint;
      const currentStatus = this.rpcStatuses.get(url);

      if (currentStatus) {
        currentStatus.status = status === 'up' ? 'up' : 'down';
      } else {
        this.rpcStatuses.set(url, {
          status: status === 'up' ? 'up' : 'down',
          latency: 0,
          alerted: false,
        });
      }
    }

    // Sync WebSocket providers
    for (const { endpoint } of this.blockchainService.getAllWsProviders()) {
      const { url, status, chainId } = endpoint;

      // Find matching WebSocket endpoint - doing a normalized URL comparison
      // to handle slight URL format differences (trailing slashes, etc.)
      const normalizedWsUrl = this.normalizeWsUrl(url);
      const wsEndpoint = this.configService.getWsEndpoints().find(e => this.normalizeWsUrl(e.url) === normalizedWsUrl);

      if (wsEndpoint) {
        const isUp = status === 'up';
        this.updateStatus(wsEndpoint, this.wsStatuses, isUp);

        // Check for downtime notifications for WebSocket endpoints
        if (!isUp) {
          this.checkDowntimeNotification(
            wsEndpoint,
            this.wsStatuses,
            ALERTS.TYPES.RPC_ENDPOINT_DOWN,
            ALERTS.COMPONENTS.WEBSOCKET,
          );
        }
      } else {
        // Handle WebSocket endpoints not found in configuration
        const currentStatus = this.wsStatuses.get(url);
        const isUp = status === 'up';

        if (currentStatus) {
          // Properly handle status transitions for better downtime tracking
          if (!isUp && currentStatus.status === 'up') {
            // Status changed to down - record when it happened
            currentStatus.status = 'down';
            currentStatus.downSince = Date.now();
            currentStatus.alerted = false;
          } else if (isUp && currentStatus.status === 'down') {
            // Status changed to up - clear downtime tracking
            currentStatus.status = 'up';
            currentStatus.downSince = undefined;
            currentStatus.alerted = false;
          } else {
            // No status change, just update the current status
            currentStatus.status = isUp ? 'up' : 'down';
          }
        } else {
          // New status entry - set downSince if it's down
          this.wsStatuses.set(url, {
            status: isUp ? 'up' : 'down',
            downSince: isUp ? undefined : Date.now(),
            alerted: false,
          });
        }

        // If it's not in the config but we have status information and it's down,
        // create a temporary endpoint object to check for downtime notification
        if (!isUp && this.wsStatuses.get(url)?.downSince) {
          const tempEndpoint = {
            url,
            name: url.split('/').pop() || 'Unknown WebSocket',
            type: 'websocket' as const,
            chainId,
          };
          this.checkDowntimeNotification(
            tempEndpoint,
            this.wsStatuses,
            ALERTS.TYPES.RPC_ENDPOINT_DOWN,
            ALERTS.COMPONENTS.WEBSOCKET,
          );
        }
      }

      this.metricsService.setWebsocketStatus(url, status === 'up', chainId);
    }
  }

  /**
   * Check and update block heights for all RPC providers
   * Detect if endpoints are falling behind in sync
   */
  private async checkProviderBlockHeights(): Promise<void> {
    // Get all online RPC endpoints
    const rpcEndpoints = this.configService.getRpcEndpoints();
    const blockHeights = new Map<string, number>();

    // Collect block heights for all endpoints
    for (const endpoint of rpcEndpoints) {
      const { url, chainId } = endpoint;
      const status = this.rpcStatuses.get(url);

      // Only check endpoints that are up
      if (status?.status === 'up') {
        try {
          // Get block height from provider
          const blockHeight = await this.blockchainService.getLatestBlockNumber(chainId, url);
          blockHeights.set(url, blockHeight);
        } catch (error) {
          this.logger.debug(`Failed to get block height for ${url}: ${error.message}`);
        }
      }
    }

    // Update RPC selector with sync status for each endpoint
    for (const endpoint of rpcEndpoints) {
      const { url, chainId } = endpoint;
      const blockHeight = blockHeights.get(url);

      // Skip endpoints we couldn't get heights for
      if (blockHeight === undefined) continue;

      // Get all heights for this chain to determine highest block
      const chainEndpoints = rpcEndpoints.filter(e => e.chainId === chainId);
      const chainHeights = chainEndpoints.map(e => blockHeights.get(e.url)).filter(h => h !== undefined);

      if (chainHeights.length === 0) continue;

      const highestBlock = Math.max(...chainHeights);
      const blocksBehind = Math.max(0, highestBlock - blockHeight);

      // Determine if the endpoint is synced with the network
      const syncedWithNetwork = blocksBehind <= this.configService.getMonitoringConfig().blockDiscrepancySyncThreshold;

      // Update RPC selector with sync status
      this.rpcSelectorService.updateEndpointSyncStatus(endpoint, syncedWithNetwork, blocksBehind);
    }

    // Note: Block height lag alerting is handled by the BlocksMonitorService.checkForBlockHeightLag method
    // which provides more comprehensive alerting with proper throttling and aggregation
  }

  /**
   * Normalize WebSocket URL to handle slight format differences
   */
  private normalizeWsUrl(url: string): string {
    // Remove trailing slashes
    let normalized = url.replace(/\/+$/, '');

    // Remove /ws suffix if present (we'll ignore this distinction for matching)
    normalized = normalized.replace(/\/ws$/, '');

    return normalized.toLowerCase();
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
      this.alertService.error(
        alertType,
        endpointType,
        `${endpointType.charAt(0).toUpperCase() + endpointType.slice(1)} endpoint ( ${endpoint.url} ) for chain ${endpoint.chainId} has been down for ${hours}h ${minutes}m`,
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
