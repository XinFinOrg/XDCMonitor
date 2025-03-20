import { ConfigService } from '@config/config.service';
import { InfluxDB, Point, WriteApi } from '@influxdata/influxdb-client';
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';

/**
 * InfluxDB Metrics Service
 * Handles all metrics recording and InfluxDB communication
 */
@Injectable()
export class MetricsService implements OnModuleInit {
  private readonly logger = new Logger(MetricsService.name);
  private influxClient: InfluxDB;
  private writeApi: WriteApi;
  private connected = false;
  private reconnectAttempts = 0;
  private connectionQueue: Point[] = [];
  private isWriteInProgress = false;

  // Configuration constants
  private readonly MAX_RECONNECT_ATTEMPTS = 10;
  private readonly RECONNECT_INTERVAL = 5000; // 5 seconds
  private readonly BATCH_SIZE = 20; // Batch writes to reduce number of requests
  private readonly FLUSH_INTERVAL = 5000; // Flush every 5 seconds
  private readonly MAX_QUEUE_SIZE = 1000; // Maximum queue size to prevent memory issues

  constructor(private readonly configService: ConfigService) {
    // Add a small delay to ensure InfluxDB is ready
    // This helps especially when running outside Docker
    setTimeout(() => this.initializeInfluxDB(), 3000); // 3 second delay
  }

  /**
   * Initialize the service when the module is loaded
   */
  onModuleInit() {
    const influxConfig = this.configService.getInfluxDbConfig();
    this.logger.log('InfluxDB metrics service initialized');
    this.logger.log(`Using bucket: ${influxConfig.bucket}`);
    this.logger.log(
      `Metrics will be batched (size: ${this.BATCH_SIZE}) and flushed every ${this.FLUSH_INTERVAL / 1000} seconds`,
    );
  }

  /**
   * Initialize the InfluxDB client and write API
   */
  private initializeInfluxDB() {
    try {
      const influxConfig = this.configService.getInfluxDbConfig();
      this.logger.log(`Connecting to InfluxDB at ${influxConfig.url}...`);
      this.logger.log(`Using token: ${influxConfig.token ? '[SET]' : '[MISSING]'}`);
      this.logger.log(`Using org: ${influxConfig.org}`);
      this.logger.log(`Using bucket: ${influxConfig.bucket}`);

      // Initialize InfluxDB client
      this.influxClient = new InfluxDB({
        url: influxConfig.url,
        token: influxConfig.token,
        timeout: 30000, // 30 seconds timeout
      });

      // Configure WriteApi with batching and retries
      this.writeApi = this.influxClient.getWriteApi(influxConfig.org, influxConfig.bucket, 'ns', {
        batchSize: this.BATCH_SIZE,
        flushInterval: this.FLUSH_INTERVAL,
        maxRetries: 5,
        maxRetryDelay: 15000,
        minRetryDelay: 1000,
        retryJitter: 1000,
        defaultTags: {},
      });

      // Set connection state and process queue
      this.connected = true;
      this.reconnectAttempts = 0;
      this.processQueue();

      // Set up periodic flush
      this.setupPeriodicFlush();
    } catch (error) {
      this.handleConnectionError(error);
    }
  }

  /**
   * Handle connection errors and schedule reconnection
   */
  private handleConnectionError(error: Error) {
    this.logger.error(`Failed to initialize InfluxDB: ${error.message}`);
    this.connected = false;
    this.scheduleReconnect();
  }

  /**
   * Set up periodic flush of metrics
   */
  private setupPeriodicFlush() {
    setInterval(() => this.flushMetrics(), this.FLUSH_INTERVAL);
  }

  /**
   * Schedule reconnection with exponential backoff
   */
  private scheduleReconnect() {
    if (this.reconnectAttempts < this.MAX_RECONNECT_ATTEMPTS) {
      this.reconnectAttempts++;
      const delay = Math.min(this.RECONNECT_INTERVAL * Math.pow(1.5, this.reconnectAttempts - 1), 60000);
      this.logger.log(
        `Attempting to reconnect to InfluxDB (attempt ${this.reconnectAttempts}/${this.MAX_RECONNECT_ATTEMPTS}) in ${delay / 1000} seconds...`,
      );

      setTimeout(() => this.initializeInfluxDB(), delay);
    } else {
      this.logger.error(`Failed to connect to InfluxDB after ${this.MAX_RECONNECT_ATTEMPTS} attempts`);
      // Reset and try again after a longer delay
      setTimeout(() => {
        this.reconnectAttempts = 0;
        this.scheduleReconnect();
      }, 60000); // Wait 1 minute before starting over
    }
  }

  /**
   * Flush metrics to InfluxDB
   */
  private async flushMetrics() {
    if (!this.connected || this.isWriteInProgress) return;

    try {
      this.isWriteInProgress = true;
      await this.writeApi.flush();
      this.isWriteInProgress = false;
    } catch (error) {
      this.isWriteInProgress = false;
      this.logger.error(`Error flushing metrics to InfluxDB: ${error.message}`);

      if (this.isConnectionError(error)) {
        this.connected = false;
        this.scheduleReconnect();
      }
    }
  }

  /**
   * Check if an error is a connection-related error
   */
  private isConnectionError(error: any): boolean {
    return ['ECONNREFUSED', 'ETIMEDOUT', 'EAI_AGAIN', 'ENOTFOUND'].includes(error.code);
  }

  /**
   * Process queued points
   */
  private processQueue() {
    if (this.connectionQueue.length === 0 || !this.connected) return;

    this.logger.log(`Processing ${this.connectionQueue.length} queued data points`);

    try {
      for (const point of this.connectionQueue) {
        this.writeApi.writePoint(point);
      }
      this.connectionQueue = [];
      this.logger.log('Successfully queued data points for writing');
    } catch (error) {
      this.logger.error(`Error writing queued points to InfluxDB: ${error.message}`);
    }
  }

  /**
   * Write a point to InfluxDB or queue it if disconnected
   */
  private writePoint(point: Point) {
    if (!this.connected) {
      this.queuePoint(point);
      return;
    }

    try {
      this.writeApi.writePoint(point);
      // Use toLineProtocol() to get a string representation that includes the measurement name
      const pointInfo = point.toLineProtocol().split(',')[0];
      this.logger.debug(`Wrote data point: ${pointInfo}`);
    } catch (error) {
      this.logger.error(`Error writing to InfluxDB: ${error.message}`);

      if (this.isConnectionError(error)) {
        this.connected = false;
        this.queuePoint(point);
        this.scheduleReconnect();
      }
    }
  }

  /**
   * Queue a point for later processing
   */
  private queuePoint(point: Point) {
    if (this.connectionQueue.length < this.MAX_QUEUE_SIZE) {
      this.connectionQueue.push(point);
    }
  }

  /**
   * Get metrics endpoint response (for compatibility with existing metrics endpoint)
   */
  async getMetrics(): Promise<string> {
    return 'Direct /metrics endpoint accessed';
  }

  //
  // Public metric recording methods
  //

  /**
   * Record blockchain block height
   */
  setBlockHeight(height: number, endpoint: string, chainId: string): void {
    this.writePoint(
      new Point('block_height').tag('chainId', chainId).tag('endpoint', endpoint).intField('value', height),
    );
    this.logger.debug(`Set block height for ${endpoint} (chainId ${chainId}): ${height}`);
  }

  /**
   * Record transactions per block
   *
   * Data is stored in a format optimized for InfluxDB time-series with:
   * - Each block having three separate points (total, success, failed)
   * - These points can be queried together using pivot() for tabular display
   * - Example query for Grafana:
   *   from(bucket: "xdc_metrics")
   *     |> filter(fn: (r) => r._measurement == "transactions_per_block" and r.chainId == "50")
   *     |> keep(columns: ["_value", "block_number", "status"])
   *     |> group()
   *     |> pivot(rowKey:["block_number"], columnKey: ["status"], valueColumn: "_value")
   *     |> sort(columns: ["block_number"], desc: true)
   */
  setTransactionsPerBlock(
    blockNumber: number,
    totalTxs: number = 0,
    success: number = 0,
    failed: number = 0,
    chainId: string = '50',
  ): void {
    const blockNumberStr = blockNumber.toString();

    this.writePoint(
      new Point('transactions_per_block')
        .tag('block_number', blockNumberStr)
        .tag('status', 'success')
        .tag('chainId', chainId)
        .intField('value', success),
    );
    this.writePoint(
      new Point('transactions_per_block')
        .tag('block_number', blockNumberStr)
        .tag('status', 'failed')
        .tag('chainId', chainId)
        .intField('value', failed),
    );
    this.writePoint(
      new Point('transactions_per_block')
        .tag('block_number', blockNumberStr)
        .tag('status', 'total')
        .tag('chainId', chainId)
        .intField('value', totalTxs),
    );

    this.logger.debug(
      `Set transactions per block for block #${blockNumber}: ${totalTxs} total, ${success} confirmed, ${failed} failed`,
    );
  }

  /**
   * Record RPC endpoint latency
   */
  recordRpcLatency(endpoint: string, latencyMs: number, chainId: number = 50): void {
    // Fix negative latency if it occurs
    const latency = latencyMs < 0 ? 0 : latencyMs;

    if (latencyMs < 0) {
      this.logger.warn(`Attempted to record negative latency (${latencyMs}ms) for ${endpoint}. Using 0ms instead.`);
    }

    this.writePoint(
      new Point('rpc_latency')
        .tag('endpoint', endpoint)
        .tag('chainId', chainId.toString())
        .floatField('value', latency),
    );
  }

  /**
   * Record service status metrics (RPC, WebSocket, Explorer, Faucet)
   */
  setServiceStatus(
    type: 'rpc' | 'websocket' | 'explorer' | 'faucet',
    endpoint: string,
    isUp: boolean,
    chainId: number = 50,
  ): void {
    this.writePoint(
      new Point(`${type}_status`)
        .tag('endpoint', endpoint)
        .tag('chainId', chainId.toString())
        .intField('value', isUp ? 1 : 0),
    );
  }

  // Convenience methods that use setServiceStatus internally
  setRpcStatus(endpoint: string, isUp: boolean, chainId: number = 50): void {
    this.setServiceStatus('rpc', endpoint, isUp, chainId);
  }

  setWebsocketStatus(endpoint: string, isUp: boolean, chainId: number = 50): void {
    this.setServiceStatus('websocket', endpoint, isUp, chainId);
  }

  setExplorerStatus(endpoint: string, isUp: boolean, chainId: number = 50): void {
    this.setServiceStatus('explorer', endpoint, isUp, chainId);
  }

  setFaucetStatus(endpoint: string, isUp: boolean, chainId: number = 50): void {
    this.setServiceStatus('faucet', endpoint, isUp, chainId);
  }

  /**
   * Record block time
   */
  setBlockTime(seconds: number, chainId: number = 50): void {
    this.writePoint(new Point('block_time').tag('chainId', chainId.toString()).floatField('value', seconds));
    this.logger.log(`Recorded block time for chainId ${chainId}: ${seconds} seconds`);
  }

  /**
   * Increment alert count
   */
  incrementAlertCount(type: string, component: string, chainId: number = 50): void {
    this.writePoint(
      new Point('alert_count')
        .tag('type', type)
        .tag('component', component)
        .tag('chainId', chainId.toString())
        .intField('value', 1),
    );
  }

  /**
   * Record transaction results
   *
   * Records the success/failure of test transactions, including:
   * - Type of transaction (normal or contract deployment)
   * - Success or failure
   * - Confirmation duration (ms)
   * - Gas used
   * - Chain ID
   * - RPC endpoint name
   */
  setTransactionMonitorResult(
    type: 'normal_transaction' | 'contract_deployment',
    success: boolean,
    duration: number,
    gasUsed: number,
    chainId: string,
    rpcName: string,
  ): void {
    // Record success/failure status
    this.writePoint(
      new Point('transaction_monitor')
        .tag('type', type)
        .tag('chainId', chainId)
        .tag('rpc', rpcName)
        .booleanField('success', success),
    );

    // Record confirmation duration
    this.writePoint(
      new Point('transaction_monitor_confirmation_time')
        .tag('type', type)
        .tag('chainId', chainId)
        .tag('rpc', rpcName)
        .intField('duration_ms', duration),
    );

    // Record gas used (if transaction was successful)
    if (success && gasUsed > 0) {
      this.writePoint(
        new Point('transaction_monitor_gas_used')
          .tag('type', type)
          .tag('chainId', chainId)
          .tag('rpc', rpcName)
          .intField('gas', gasUsed),
      );
    }

    this.logger.debug(
      `Recorded transaction test: type=${type}, chainId=${chainId}, rpc=${rpcName}, ` +
        `success=${success}, duration=${duration}ms, gas=${gasUsed}`,
    );
  }

  /**
   * Record wallet balance information
   *
   * @param chainId The chain ID ('50' for Mainnet, '51' for Testnet)
   * @param balance The wallet balance in XDC
   * @param sufficient Whether the balance is sufficient for testing
   */
  setWalletBalance(chainId: string, balance: string, sufficient: boolean): void {
    const chainName = chainId === '50' ? 'Mainnet' : 'Testnet';

    this.writePoint(
      new Point('transaction_wallet_balance')
        .tag('chainId', chainId)
        .tag('network', chainName)
        .tag('sufficient', sufficient ? 'true' : 'false')
        .floatField('balance', parseFloat(balance)),
    );

    // Also record a separate boolean field for "sufficient" to make it easier to query
    this.writePoint(
      new Point('transaction_wallet_status')
        .tag('chainId', chainId)
        .tag('network', chainName)
        .booleanField('sufficient_balance', sufficient),
    );
  }

  /**
   * Record transactions per minute
   */
  setTransactionsPerMinute(txPerMinute: number, chainId: number = 50): void {
    this.writePoint(
      new Point('transactions_per_minute').tag('chainId', chainId.toString()).floatField('value', txPerMinute),
    );
    this.logger.debug(`Set transactions per minute for chainId ${chainId}: ${txPerMinute.toFixed(2)}`);
  }
}
