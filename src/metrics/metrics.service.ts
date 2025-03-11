import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@config/config.service';
import * as promClient from 'prom-client';

@Injectable()
export class MetricsService implements OnModuleInit {
  private readonly logger = new Logger(MetricsService.name);
  private register: promClient.Registry;

  private blockHeight: promClient.Gauge<string>;
  private transactionCount: promClient.Counter<string>;
  private rpcLatency: promClient.Histogram<string>;
  private rpcStatus: promClient.Gauge<string>;
  private blockTime: promClient.Gauge<string>;
  private alertCount: promClient.Counter<string>;
  private transactionsPerBlock: promClient.Gauge<string>;
  private websocketStatus: promClient.Gauge<string>;
  private explorerStatus: promClient.Gauge<string>;
  private faucetStatus: promClient.Gauge<string>;

  constructor(private readonly configService: ConfigService) {
    this.register = new promClient.Registry();

    promClient.collectDefaultMetrics({ register: this.register });

    this.blockHeight = new promClient.Gauge({
      name: 'xdc_block_height',
      help: 'Current XDC blockchain height',
      labelNames: ['network', 'endpoint'],
      registers: [this.register],
    });

    this.transactionCount = new promClient.Counter({
      name: 'xdc_transaction_count',
      help: 'Number of XDC transactions processed',
      labelNames: ['status', 'network'],
      registers: [this.register],
    });

    this.transactionsPerBlock = new promClient.Gauge({
      name: 'xdc_transactions_per_block',
      help: 'Number of transactions in each block',
      labelNames: ['block_number', 'status', 'network'],
      registers: [this.register],
    });

    this.rpcLatency = new promClient.Histogram({
      name: 'xdc_rpc_latency',
      help: 'Latency of RPC endpoint responses in ms',
      labelNames: ['endpoint', 'network'],
      buckets: [5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000],
      registers: [this.register],
    });

    this.rpcStatus = new promClient.Gauge({
      name: 'xdc_rpc_status',
      help: 'RPC endpoint status (1=up, 0=down)',
      labelNames: ['endpoint', 'network'],
      registers: [this.register],
    });

    this.websocketStatus = new promClient.Gauge({
      name: 'xdc_websocket_status',
      help: 'WebSocket endpoint status (1=up, 0=down)',
      labelNames: ['endpoint', 'network'],
      registers: [this.register],
    });

    this.explorerStatus = new promClient.Gauge({
      name: 'xdc_explorer_status',
      help: 'XDC block explorer status (1=up, 0=down)',
      labelNames: ['endpoint', 'network'],
      registers: [this.register],
    });

    this.faucetStatus = new promClient.Gauge({
      name: 'xdc_faucet_status',
      help: 'XDC faucet service status (1=up, 0=down)',
      labelNames: ['endpoint', 'network'],
      registers: [this.register],
    });

    this.blockTime = new promClient.Gauge({
      name: 'xdc_block_time',
      help: 'Time between blocks in seconds',
      labelNames: ['network'],
      registers: [this.register],
    });

    this.alertCount = new promClient.Counter({
      name: 'xdc_alert_count',
      help: 'Count of alerts by type and component',
      labelNames: ['type', 'component', 'network'],
      registers: [this.register],
    });
  }

  onModuleInit() {
    this.logger.log('Metrics service initialized');
  }

  getMetrics(): Promise<string> {
    return this.register.metrics();
  }

  setBlockHeight(height: number, endpoint: string, networkId: string): void {
    this.blockHeight.labels(networkId, endpoint).set(height);
    this.logger.debug(`Set block height for ${endpoint} (network ${networkId}): ${height}`);
  }

  incrementTransactionCount(status: 'confirmed' | 'pending' | 'failed', networkId: string = '50'): void {
    this.transactionCount.labels(status, networkId).inc();
  }

  setTransactionsPerBlock(blockNumber: number, confirmed: number, failed: number, networkId: string = '50'): void {
    const blockNumberStr = blockNumber.toString();

    // Reset any existing values for this block to ensure we don't have stale data
    // This is important when refreshing metrics for the same block
    try {
      this.transactionsPerBlock.remove({ block_number: blockNumberStr, status: 'confirmed', network: networkId });
      this.transactionsPerBlock.remove({ block_number: blockNumberStr, status: 'failed', network: networkId });
    } catch (error) {
      // Ignore errors if label combination doesn't exist yet
    }

    // Set new values
    if (confirmed >= 0) {
      this.transactionsPerBlock.labels(blockNumberStr, 'confirmed', networkId).set(confirmed);
      this.logger.debug(`Set confirmed transactions for block #${blockNumber}: ${confirmed}`);
    }

    if (failed >= 0) {
      this.transactionsPerBlock.labels(blockNumberStr, 'failed', networkId).set(failed);
      this.logger.debug(`Set failed transactions for block #${blockNumber}: ${failed}`);
    }
  }

  recordRpcLatency(endpoint: string, latencyMs: number, isMainnet: boolean = true): void {
    const networkId = isMainnet ? '50' : '51';
    this.rpcLatency.labels(endpoint, networkId).observe(latencyMs);
  }

  setRpcStatus(endpoint: string, isUp: boolean, isMainnet: boolean = true): void {
    const networkId = isMainnet ? '50' : '51';
    this.rpcStatus.labels(endpoint, networkId).set(isUp ? 1 : 0);
  }

  setWebsocketStatus(endpoint: string, isUp: boolean, isMainnet: boolean = true): void {
    const networkId = isMainnet ? '50' : '51';
    this.websocketStatus.labels(endpoint, networkId).set(isUp ? 1 : 0);
  }

  setExplorerStatus(endpoint: string, isUp: boolean, isMainnet: boolean = true): void {
    const networkId = isMainnet ? '50' : '51';
    this.explorerStatus.labels(endpoint, networkId).set(isUp ? 1 : 0);
  }

  setFaucetStatus(endpoint: string, isUp: boolean, isMainnet: boolean = true): void {
    const networkId = isMainnet ? '50' : '51';
    this.faucetStatus.labels(endpoint, networkId).set(isUp ? 1 : 0);
  }

  setBlockTime(seconds: number, network = '50'): void {
    this.blockTime.labels(network).set(seconds);
  }

  incrementAlertCount(type: string, component: string, isMainnet: boolean = true): void {
    const networkId = isMainnet ? '50' : '51';
    this.alertCount.labels(type, component, networkId).inc();
  }
}
