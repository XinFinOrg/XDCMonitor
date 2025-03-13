import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@config/config.service';
import { InfluxDB, Point } from '@influxdata/influxdb-client';
import { hostname } from 'os';

@Injectable()
export class MetricsService implements OnModuleInit {
  private readonly logger = new Logger(MetricsService.name);
  private influxClient: InfluxDB;
  private writeApi: any;
  private connected = false;
  private reconnectAttempts = 0;
  private readonly MAX_RECONNECT_ATTEMPTS = 10;
  private readonly RECONNECT_INTERVAL = 5000; // 5 seconds
  private readonly INITIAL_CONNECT_DELAY = 30000; // 30 seconds (increased from 15)
  private connectionQueue: Point[] = [];

  constructor(private readonly configService: ConfigService) {
    // Wait for InfluxDB to be ready before connecting
    setTimeout(() => {
      this.initializeInfluxDB();
    }, this.INITIAL_CONNECT_DELAY);
  }

  private initializeInfluxDB() {
    try {
      this.logger.log(`Connecting to InfluxDB at ${this.configService.influxDbUrl}...`);
      this.logger.log(`Using token: ${this.configService.influxDbToken ? '[SET]' : '[MISSING]'}`);
      this.logger.log(`Using org: ${this.configService.influxDbOrg}`);
      this.logger.log(`Using bucket: ${this.configService.influxDbBucket}`);

      // Initialize InfluxDB client
      this.influxClient = new InfluxDB({
        url: this.configService.influxDbUrl,
        token: this.configService.influxDbToken,
      });

      // Get WriteApi to write data points
      this.writeApi = this.influxClient.getWriteApi(
        this.configService.influxDbOrg,
        this.configService.influxDbBucket,
        'ns',
      );

      // Set default tags for all metrics
      this.writeApi.useDefaultTags({ host: hostname() });
      this.connected = true;
      this.reconnectAttempts = 0;

      // Process any queued points
      this.processQueue();
    } catch (error) {
      this.logger.error(`Failed to initialize InfluxDB: ${error.message}`);
      this.connected = false;
      this.scheduleReconnect();
    }
  }

  private processQueue() {
    if (this.connectionQueue.length > 0 && this.connected) {
      this.logger.log(`Processing ${this.connectionQueue.length} queued data points`);

      for (const point of this.connectionQueue) {
        try {
          this.writeApi.writePoint(point);
        } catch (error) {
          this.logger.error(`Error writing queued point to InfluxDB: ${error.message}`);
        }
      }

      try {
        this.writeApi.flush();
        this.connectionQueue = [];
      } catch (error) {
        this.logger.error(`Error flushing queued points to InfluxDB: ${error.message}`);
      }
    }
  }

  private scheduleReconnect() {
    if (this.reconnectAttempts < this.MAX_RECONNECT_ATTEMPTS) {
      this.reconnectAttempts++;
      this.logger.log(
        `Attempting to reconnect to InfluxDB (attempt ${this.reconnectAttempts}/${this.MAX_RECONNECT_ATTEMPTS})...`,
      );

      setTimeout(() => {
        this.initializeInfluxDB();
      }, this.RECONNECT_INTERVAL);
    } else {
      this.logger.error(`Failed to connect to InfluxDB after ${this.MAX_RECONNECT_ATTEMPTS} attempts`);
      // Reset so we can try again later
      setTimeout(() => {
        this.reconnectAttempts = 0;
        this.scheduleReconnect();
      }, 60000); // Wait 1 minute before starting over
    }
  }

  onModuleInit() {
    this.logger.log('InfluxDB metrics service initialized');
    this.logger.log(
      `Will connect to InfluxDB at ${this.configService.influxDbUrl} after ${this.INITIAL_CONNECT_DELAY}ms delay`,
    );
    this.logger.log(`Using bucket: ${this.configService.influxDbBucket}`);
  }

  /**
   * Write a point to InfluxDB
   * @param point InfluxDB Point to write
   */
  private async writePoint(point: Point) {
    if (!this.connected) {
      // Queue the point for later when connection is established
      if (this.connectionQueue.length < 1000) {
        // Limit queue size to prevent memory issues
        this.connectionQueue.push(point);
      }
      return;
    }

    try {
      this.writeApi.writePoint(point);
      await this.writeApi.flush();
    } catch (error) {
      this.logger.error(`Error writing to InfluxDB: ${error.message}`);

      // If connection refused or other serious error, try to reconnect
      if (error.code === 'ECONNREFUSED' || error.code === 'ETIMEDOUT') {
        this.connected = false;
        // Queue the point that failed
        if (this.connectionQueue.length < 1000) {
          this.connectionQueue.push(point);
        }
        this.scheduleReconnect();
      }
    }
  }

  /**
   * Get metrics endpoint response (for compatibility with existing metrics endpoint)
   * This will always return an empty string as InfluxDB uses push model instead of pull
   */
  async getMetrics(): Promise<string> {
    return '';
  }

  /**
   * Record blockchain block height
   * @param height Block height
   * @param endpoint RPC endpoint URL
   * @param chainId Chain ID
   */
  setBlockHeight(height: number, endpoint: string, chainId: string): void {
    const point = new Point('block_height').tag('chainId', chainId).tag('endpoint', endpoint).intField('value', height);

    this.writePoint(point);
    this.logger.debug(`Set block height for ${endpoint} (chainId ${chainId}): ${height}`);
  }

  /**
   * Increment transaction count by status
   * @param status Transaction status
   * @param chainId Chain ID
   */
  incrementTransactionCount(status: 'confirmed' | 'pending' | 'failed', chainId: string = '50'): void {
    const point = new Point('transaction_count').tag('status', status).tag('chainId', chainId).intField('value', 1);

    this.writePoint(point);
  }

  /**
   * Record transactions per block
   * @param blockNumber Block number
   * @param confirmed Count of confirmed transactions
   * @param failed Count of failed transactions
   * @param chainId Chain ID
   */
  setTransactionsPerBlock(blockNumber: number, confirmed: number, failed: number, chainId: string = '50'): void {
    const blockNumberStr = blockNumber.toString();

    if (confirmed >= 0) {
      const confirmedPoint = new Point('transactions_per_block')
        .tag('block_number', blockNumberStr)
        .tag('status', 'confirmed')
        .tag('chainId', chainId)
        .intField('value', confirmed);

      this.writePoint(confirmedPoint);
      this.logger.debug(`Set confirmed transactions for block #${blockNumber}: ${confirmed}`);
    }

    if (failed >= 0) {
      const failedPoint = new Point('transactions_per_block')
        .tag('block_number', blockNumberStr)
        .tag('status', 'failed')
        .tag('chainId', chainId)
        .intField('value', failed);

      this.writePoint(failedPoint);
      this.logger.debug(`Set failed transactions for block #${blockNumber}: ${failed}`);
    }
  }

  /**
   * Record RPC endpoint latency
   * @param endpoint RPC endpoint URL
   * @param latencyMs Latency in milliseconds
   * @param chainId Chain ID
   */
  recordRpcLatency(endpoint: string, latencyMs: number, chainId: number = 50): void {
    const point = new Point('rpc_latency')
      .tag('endpoint', endpoint)
      .tag('chainId', chainId.toString())
      .floatField('value', latencyMs);

    this.writePoint(point);
  }

  /**
   * Record RPC endpoint status
   * @param endpoint RPC endpoint URL
   * @param isUp Whether the endpoint is up
   * @param chainId Chain ID
   */
  setRpcStatus(endpoint: string, isUp: boolean, chainId: number = 50): void {
    const point = new Point('rpc_status')
      .tag('endpoint', endpoint)
      .tag('chainId', chainId.toString())
      .intField('value', isUp ? 1 : 0);

    this.writePoint(point);
  }

  /**
   * Record WebSocket endpoint status
   * @param endpoint WebSocket endpoint URL
   * @param isUp Whether the endpoint is up
   * @param chainId Chain ID
   */
  setWebsocketStatus(endpoint: string, isUp: boolean, chainId: number = 50): void {
    const point = new Point('websocket_status')
      .tag('endpoint', endpoint)
      .tag('chainId', chainId.toString())
      .intField('value', isUp ? 1 : 0);

    this.writePoint(point);
  }

  /**
   * Record explorer status
   * @param endpoint Explorer URL
   * @param isUp Whether the explorer is up
   * @param chainId Chain ID
   */
  setExplorerStatus(endpoint: string, isUp: boolean, chainId: number = 50): void {
    const point = new Point('explorer_status')
      .tag('endpoint', endpoint)
      .tag('chainId', chainId.toString())
      .intField('value', isUp ? 1 : 0);

    this.writePoint(point);
  }

  /**
   * Record faucet status
   * @param endpoint Faucet URL
   * @param isUp Whether the faucet is up
   * @param chainId Chain ID
   */
  setFaucetStatus(endpoint: string, isUp: boolean, chainId: number = 50): void {
    const point = new Point('faucet_status')
      .tag('endpoint', endpoint)
      .tag('chainId', chainId.toString())
      .intField('value', isUp ? 1 : 0);

    this.writePoint(point);
  }

  /**
   * Record block time
   * @param seconds Block time in seconds
   * @param chainId Chain ID
   */
  setBlockTime(seconds: number, chainId: number = 50): void {
    const point = new Point('block_time').tag('chainId', chainId.toString()).floatField('value', seconds);

    this.writePoint(point);
  }

  /**
   * Increment alert count
   * @param type Alert type
   * @param component Component that triggered the alert
   * @param chainId Chain ID
   */
  incrementAlertCount(type: string, component: string, chainId: number = 50): void {
    const point = new Point('alert_count')
      .tag('type', type)
      .tag('component', component)
      .tag('chainId', chainId.toString())
      .intField('value', 1);

    this.writePoint(point);
  }
}
