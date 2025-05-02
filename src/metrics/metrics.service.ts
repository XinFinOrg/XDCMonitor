import { ConfigService } from '@config/config.service';
import { InfluxDB, Point, WriteApi } from '@influxdata/influxdb-client';
import { Alert } from '@alerts/alert.service';
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { MinerRecord, MinerStatus } from '@types';
import { SECURITY_METRICS, SeverityLevel } from '@common/constants/security';

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
    const point = new Point('block_height')
      .tag('chainId', chainId)
      .tag('endpoint', endpoint)
      .intField('height', height);

    this.writePoint(point);
  }

  /**
   * Record block height variance between RPC endpoints for a network
   * @param network Network identifier (mainnet/testnet)
   * @param variance The block height variance in number of blocks
   */
  setBlockHeightVariance(network: string, variance: number): void {
    const point = new Point('block_height_variance').tag('network', network).intField('variance', variance);

    this.writePoint(point);
  }

  /**
   * Record block response time for an endpoint
   * @param endpoint RPC endpoint
   * @param responseTimeMs Response time in milliseconds
   * @param chainId Chain ID
   */
  setBlockResponseTime(endpoint: string, responseTimeMs: number, chainId: number): void {
    const point = new Point('block_response_time')
      .tag('endpoint', endpoint)
      .tag('chainId', chainId.toString())
      .intField('ms', responseTimeMs);

    this.writePoint(point);
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
    chainId: number = 50,
  ): void {
    const blockNumberStr = blockNumber.toString();

    this.logger.debug(
      `Writing transaction metrics for block #${blockNumber} (chain ${chainId}): ` +
        `${totalTxs} total, ${success} success, ${failed} failed`,
    );

    this.writePoint(
      new Point('transactions_per_block')
        .tag('block_number', blockNumberStr)
        .tag('status', 'success')
        .tag('chainId', chainId.toString())
        .intField('value', success),
    );
    this.writePoint(
      new Point('transactions_per_block')
        .tag('block_number', blockNumberStr)
        .tag('status', 'failed')
        .tag('chainId', chainId.toString())
        .intField('value', failed),
    );
    this.writePoint(
      new Point('transactions_per_block')
        .tag('block_number', blockNumberStr)
        .tag('status', 'total')
        .tag('chainId', chainId.toString())
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
   * Record peer count for an endpoint
   * 
   * @param endpoint The RPC/WebSocket endpoint URL
   * @param peerCount Number of peers connected to the node
   * @param endpointType Type of endpoint (rpc/websocket)
   * @param chainId Chain ID (50 for mainnet, 51 for testnet)
   */
  setPeerCount(endpoint: string, peerCount: number, endpointType: 'rpc' | 'websocket', chainId: number = 50): void {
    this.writePoint(
      new Point('peer_count')
        .tag('endpoint', endpoint)
        .tag('type', endpointType)
        .tag('chainId', chainId.toString())
        .intField('value', peerCount)
    );
    this.logger.debug(`Recorded peer count for ${endpointType} ${endpoint} (chain ${chainId}): ${peerCount} peers`);
  }

  /**
   * Record block time
   */
  setBlockTime(seconds: number, chainId: number = 50): void {
    this.writePoint(new Point('block_time').tag('chainId', chainId.toString()).floatField('value', seconds));
    this.logger.log(`Recorded block time for chainId ${chainId}: ${seconds} seconds`);
  }

  /**
   * Save alert history
   *
   * @param alert Alert object
   * @param chainId Chain ID
   */
  saveAlert(alert: Alert, chainId?: number): void {
    this.writePoint(
      new Point('alert_history')
        .tag('type', alert.type)
        .tag('title', alert.title)
        .tag('component', alert.component)
        .tag('chainId', chainId?.toString() || 'null')
        .stringField('value', alert.message),
    );
  }

  /**
   * Record transaction results
   *
   * Records the success/failure of test transactions, including:
   * - Type of transaction (normal or contract deployment)
   * - Success or failure
   * - Confirmation duration (ms)
   * - Chain ID
   * - RPC endpoint name
   */
  setTransactionMonitorResult(
    type: 'normal_transaction' | 'contract_deployment',
    success: boolean,
    duration: number,
    chainId: number,
    rpcUrl: string,
  ): void {
    this.writePoint(
      new Point('transaction_monitor')
        .tag('type', type)
        .tag('chainId', chainId.toString())
        .tag('rpc', rpcUrl)
        .booleanField('success', success),
    );

    this.writePoint(
      new Point('transaction_monitor_confirmation_time')
        .tag('type', type)
        .tag('chainId', chainId.toString())
        .tag('rpc', rpcUrl)
        .intField('duration_ms', duration),
    );

    this.logger.debug(
      `Recorded transaction test: type=${type}, chainId=${chainId}, rpc=${rpcUrl}, ` +
        `success=${success}, duration=${duration}ms`,
    );
  }

  /**
   * Record wallet balance information
   *
   * @param chainId The chain ID (50 for Mainnet, 51 for Testnet)
   * @param balance The wallet balance in XDC
   * @param sufficient Whether the balance is sufficient for testing
   */
  setWalletBalance(chainId: number, balance: string, sufficient: boolean): void {
    const chainName = chainId === 50 ? 'Mainnet' : 'Testnet';

    this.writePoint(
      new Point('transaction_wallet_balance')
        .tag('chainId', chainId.toString())
        .tag('network', chainName)
        .tag('sufficient', sufficient ? 'true' : 'false')
        .floatField('balance', parseFloat(balance)),
    );

    // Also record a separate boolean field for "sufficient" to make it easier to query
    this.writePoint(
      new Point('transaction_wallet_status')
        .tag('chainId', chainId.toString())
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

  /**
   * Record validator nodes summary data
   *
   * @param chainId The chain ID
   * @param epoch Current epoch number
   * @param masternodeCount Number of active masternodes
   * @param standbyCount Number of standby nodes
   * @param penaltyCount Number of nodes in penalty
   * @param blockNumber Current block number
   * @param round Current consensus round
   */
  recordValidatorSummary(
    chainId: number,
    epoch: number,
    masternodeCount: number,
    standbyCount: number,
    penaltyCount: number,
    blockNumber: number,
    round: number,
  ): void {
    this.writePoint(
      new Point('validator_summary')
        .tag('chainId', chainId.toString())
        .tag('epoch', epoch.toString())
        .intField('masternode_count', masternodeCount)
        .intField('standbynode_count', standbyCount)
        .intField('penalty_count', penaltyCount)
        .intField('block_number', blockNumber)
        .intField('round', round),
    );
  }

  /**
   * Record validator node details
   *
   * @param chainId The chain ID
   * @param epoch Current epoch number
   * @param address Node address
   * @param status Node status (masternode, standby, penalty)
   * @param index Node index in the list (optional)
   */
  recordValidatorDetail(
    chainId: number,
    epoch: number,
    blockNumber: number,
    round: number,
    address: string,
    status: MinerStatus,
    index?: number,
  ): void {
    this.writePoint(
      new Point('validator_nodes')
        .tag('chainId', chainId.toString())
        .tag('epoch', epoch.toString())
        .tag('block_number', blockNumber.toString())
        .tag('round', round.toString())
        .tag('address', address.toLowerCase())
        .tag('status', status)
        .intField('index', index ?? 0),
    );
  }

  /**
   * Get the InfluxDB client instance for other services to use
   * NOTE: This should be used carefully to prevent bypassing error handling and queue mechanisms
   */
  getInfluxClient(): InfluxDB | null {
    return this.connected ? this.influxClient : null;
  }

  /**
   * Record a missed round event
   *
   * @param chainId The chain ID
   * @param blockNumber The block number where the missed round was detected
   * @param round The round number that was missed
   * @param epoch The epoch number
   * @param epochRound The round number start of the epoch
   * @param epochBlock The block number start of the epoch
   * @param expectedMiner The address of the miner that missed its turn
   * @param actualMiner The address of the miner that actually mined the block
   * @param missedMinersCount Number of consecutive miners that missed their turn
   */
  recordMissedRound(
    chainId: number,
    blockNumber: number,
    round: number,
    epoch: number,
    epochRound: number,
    epochBlock: number,
    expectedMiner: string,
    actualMiner: string,
    missedMinersCount: number = 1,
  ): void {
    this.writePoint(
      new Point('consensus_missed_rounds')
        .tag('chainId', chainId.toString())
        .tag('expected_miner', expectedMiner.toLowerCase())
        .tag('actual_miner', actualMiner.toLowerCase())
        .intField('block_number', blockNumber)
        .intField('round', round)
        .intField('epoch', epoch)
        .intField('epoch_round', epochRound)
        .intField('epoch_block', epochBlock)
        .intField('missed_miners_count', missedMinersCount)
        .timestamp(new Date()),
    );

    this.logger.debug(
      `Recorded missed round: chainId=${chainId}, block=${blockNumber}, round=${round}, ` +
        `expectedMiner=${expectedMiner}, actualMiner=${actualMiner}, missedMiners=${missedMinersCount}`,
    );
  }

  /**
   * Record a timeout period for a missed round
   *
   * @param chainId The chain ID
   * @param blockNumber The block number where timeout occurred
   * @param round The round number where timeout occurred
   * @param epoch The epoch number
   * @param epochRound The round number start of the epoch
   * @param epochBlock The block number start of the epoch
   * @param timeoutPeriod The actual timeout period in seconds
   * @param expectedTimeoutPerMiner The expected timeout period per missed miner (normally ~10s)
   * @param missedMiners The number of miners that were missed
   */
  recordTimeoutPeriod(
    chainId: number,
    blockNumber: number,
    round: number,
    epoch: number,
    epochRound: number,
    epochBlock: number,
    timeoutPeriod: number,
    expectedTimeoutPerMiner: number = 10,
    missedMiners: number = 1,
  ): void {
    const expectedTimeout = expectedTimeoutPerMiner * missedMiners;
    const variance = Math.abs(timeoutPeriod - expectedTimeout);
    const isConsistent = variance <= 2; // Within 2 seconds of expected timeout

    this.writePoint(
      new Point('consensus_timeout_periods')
        .tag('chainId', chainId.toString())
        .tag('is_consistent', isConsistent ? 'true' : 'false')
        .intField('block_number', blockNumber)
        .intField('round', round)
        .intField('epoch', epoch)
        .intField('epoch_round', epochRound)
        .intField('epoch_block', epochBlock)
        .floatField('timeout_period', timeoutPeriod)
        .floatField('expected_timeout', expectedTimeout)
        .intField('missed_miners', missedMiners)
        .floatField('variance', variance)
        .timestamp(new Date()),
    );

    this.logger.debug(
      `Recorded timeout period: chainId=${chainId}, block=${blockNumber}, ` +
        `timeout=${timeoutPeriod}s, expected=${expectedTimeout}s for ${missedMiners} missed miner(s), ` +
        `variance=${variance}s, consistent=${isConsistent}`,
    );
  }

  /**
   * Record a miner's missed round statistics
   *
   * @param chainId The chain ID
   * @param minerAddress The miner's address
   * @param missedBlocks The total number of blocks missed by this miner
   */
  recordMinerMissedRound(chainId: number, minerAddress: string, missedBlocks: number): void {
    this.writePoint(
      new Point('consensus_miner_missed_rounds')
        .tag('chainId', chainId.toString())
        .tag('miner', minerAddress.toLowerCase())
        .intField('missed_blocks', missedBlocks)
        .timestamp(new Date()),
    );

    this.logger.debug(
      `Updated miner missed round stats: chainId=${chainId}, miner=${minerAddress}, ` + `missedBlocks=${missedBlocks}`,
    );
  }

  /**
   * Record comprehensive miner performance metrics
   *
   * @param chainId The chain ID
   * @param minerAddress The miner's address
   * @param totalBlocksMined Total blocks successfully mined by this validator
   * @param missedBlocks Total blocks missed by this validator
   * @param blockNumber The latest block number for this update
   */
  recordMinerPerformance(
    chainId: number,
    minerAddress: string,
    totalBlocksMined: number,
    missedBlocks: number,
    blockNumber: number,
  ): void {
    // Calculate success rate as percentage
    const totalAttempts = totalBlocksMined + missedBlocks;
    const successRate = totalAttempts > 0 ? (totalBlocksMined / totalAttempts) * 100 : 100;

    this.writePoint(
      new Point('consensus_miner_performance')
        .tag('chainId', chainId.toString())
        .tag('miner', minerAddress.toLowerCase())
        .intField('total_blocks_mined', totalBlocksMined)
        .intField('missed_blocks', missedBlocks)
        .intField('total_attempts', totalAttempts)
        .floatField('success_rate', successRate)
        .intField('last_block', blockNumber)
        .timestamp(new Date()),
    );

    this.logger.debug(
      `Updated miner performance: chainId=${chainId}, miner=${minerAddress}, ` +
        `totalMined=${totalBlocksMined}, missed=${missedBlocks}, successRate=${successRate.toFixed(2)}%`,
    );
  }

  /**
   * Retrieve historical miner performance data from InfluxDB
   *
   * @param chainId The chain ID
   * @param minerAddresses Array of miner addresses to fetch data for
   * @returns Object mapping miner addresses to their performance data
   */
  async getMinerPerformanceData(
    chainId: number,
    minerAddresses: string[],
  ): Promise<
    Record<
      string,
      {
        totalBlocksMined: number;
        missedBlocks: number;
        lastActiveBlock: number;
        lastActive: string | null;
      }
    >
  > {
    if (!this.connected || !this.influxClient) {
      this.logger.warn('Cannot get miner performance data - InfluxDB not connected');
      return {};
    }

    try {
      const config = this.configService.getInfluxDbConfig();
      const queryApi = this.influxClient.getQueryApi(config.org);

      // Prepare address list for the query
      const addressList = minerAddresses.map(addr => `"${addr.toLowerCase()}"`).join(', ');

      // Query to get the latest performance data for each miner
      const query = `
        from(bucket: "${config.bucket}")
          |> range(start: -30d)
          |> filter(fn: (r) => r._measurement == "consensus_miner_performance")
          |> filter(fn: (r) => r.chainId == "${chainId}")
          |> filter(fn: (r) => contains(value: r.miner, set: [${addressList}]))
          |> pivot(rowKey:["_time"], columnKey: ["_field"], valueColumn: "_value")
          |> group(columns: ["miner"])
          |> last()
      `;

      const result: Record<
        string,
        {
          totalBlocksMined: number;
          missedBlocks: number;
          lastActiveBlock: number;
          lastActive: string | null;
        }
      > = {};

      // Execute query and process results
      const records = await queryApi.collectRows(query);
      this.logger.debug(`Retrieved ${records.length} miner performance records from InfluxDB`);

      // Process each record
      for (const record of records) {
        // Type cast the record to our expected structure
        const minerRecord = record as MinerRecord;
        const minerAddress = minerRecord.miner?.toLowerCase();
        if (!minerAddress) continue;

        result[minerAddress] = {
          totalBlocksMined: parseInt(String(minerRecord.total_blocks_mined ?? '0')),
          missedBlocks: parseInt(String(minerRecord.missed_blocks ?? '0')),
          lastActiveBlock: parseInt(String(minerRecord.last_block ?? '0')),
          lastActive: minerRecord._time ?? null,
        };
      }

      return result;
    } catch (error) {
      this.logger.error(`Failed to retrieve miner performance data: ${error.message}`);
      return {};
    }
  }

  /**
   * Record a security scan event
   * 
   * @param vulnerableTargets Number of targets with vulnerabilities
   * @param criticalIssues Number of critical severity issues
   * @param highIssues Number of high severity issues
   * @param mediumIssues Number of medium severity issues
   * @param lowIssues Number of low severity issues
   */
  recordSecurityScan(vulnerableTargets: number, criticalIssues: number, highIssues: number, 
                     mediumIssues: number, lowIssues: number): void {
    const point = new Point(SECURITY_METRICS.SECURITY_SCAN)
      .intField('vulnerable_targets', vulnerableTargets)
      .intField('critical_issues', criticalIssues)
      .intField('high_issues', highIssues)
      .intField('medium_issues', mediumIssues)
      .intField('low_issues', lowIssues)
      .intField('total_issues', criticalIssues + highIssues + mediumIssues + lowIssues);
      
    this.writePoint(point);
  }

  /**
   * Record network scan metrics
   * 
   * @param scannedEndpoints Number of endpoints scanned
   * @param vulnerableTargets Number of targets with vulnerabilities
   * @param criticalVulns Number of critical vulnerabilities
   * @param highVulns Number of high vulnerabilities
   * @param mediumVulns Number of medium vulnerabilities
   * @param lowVulns Number of low vulnerabilities
   */
  recordNetworkScanMetrics(scannedEndpoints: number, vulnerableTargets: number, 
                           criticalVulns: number, highVulns: number, mediumVulns: number, lowVulns: number): void {
    const point = new Point(SECURITY_METRICS.NETWORK_SCAN)
      .intField('scanned_endpoints', scannedEndpoints)
      .intField('vulnerable_targets', vulnerableTargets)
      .intField('critical_vulnerabilities', criticalVulns)
      .intField('high_vulnerabilities', highVulns)
      .intField('medium_vulnerabilities', mediumVulns)
      .intField('low_vulnerabilities', lowVulns);
      
    this.writePoint(point);
  }

  /**
   * Record vulnerability types distribution
   * 
   * @param typeCounts Record of vulnerability types and their counts
   */
  recordVulnerabilityTypes(typeCounts: Record<string, number>): void {
    const point = new Point(SECURITY_METRICS.VULNERABILITY);
    
    // Add each vulnerability type as a field
    for (const [type, count] of Object.entries(typeCounts)) {
      point.intField(type, count);
    }
    
    this.writePoint(point);
  }

  /**
   * Record configuration audit metrics
   * 
   * @param configsAudited Number of configurations audited
   * @param configsWithIssues Number of configurations with issues
   * @param criticalFindings Number of critical findings
   * @param highFindings Number of high findings
   * @param mediumFindings Number of medium findings
   * @param lowFindings Number of low findings
   */
  recordConfigAuditMetrics(configsAudited: number, configsWithIssues: number, 
                           criticalFindings: number, highFindings: number, 
                           mediumFindings: number, lowFindings: number): void {
    const point = new Point(SECURITY_METRICS.CONFIG_AUDIT)
      .intField('configs_audited', configsAudited)
      .intField('configs_with_issues', configsWithIssues)
      .intField('critical_findings', criticalFindings)
      .intField('high_findings', highFindings)
      .intField('medium_findings', mediumFindings)
      .intField('low_findings', lowFindings);
      
    this.writePoint(point);
  }

  /**
   * Record finding types distribution
   * 
   * @param typeCounts Record of finding types and their counts
   */
  recordFindingTypes(typeCounts: Record<string, number>): void {
    const point = new Point(SECURITY_METRICS.CONFIG_FINDING);
    
    // Add each finding type as a field
    for (const [type, count] of Object.entries(typeCounts)) {
      point.intField(type, count);
    }
    
    this.writePoint(point);
  }
}
