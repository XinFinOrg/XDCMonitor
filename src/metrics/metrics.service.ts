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

  constructor(private readonly configService: ConfigService) {
    this.register = new promClient.Registry();

    promClient.collectDefaultMetrics({ register: this.register });

    this.blockHeight = new promClient.Gauge({
      name: 'xdc_block_height',
      help: 'Current XDC blockchain height',
      labelNames: ['network'],
      registers: [this.register],
    });

    this.transactionCount = new promClient.Counter({
      name: 'xdc_transaction_count',
      help: 'Number of XDC transactions processed',
      labelNames: ['status'],
      registers: [this.register],
    });

    this.transactionsPerBlock = new promClient.Gauge({
      name: 'xdc_transactions_per_block',
      help: 'Number of transactions in each block',
      labelNames: ['block_number', 'status'],
      registers: [this.register],
    });

    this.rpcLatency = new promClient.Histogram({
      name: 'xdc_rpc_latency',
      help: 'Latency of RPC endpoint responses in ms',
      labelNames: ['endpoint'],
      buckets: [5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000],
      registers: [this.register],
    });

    this.rpcStatus = new promClient.Gauge({
      name: 'xdc_rpc_status',
      help: 'RPC endpoint status (1=up, 0=down)',
      labelNames: ['endpoint'],
      registers: [this.register],
    });

    this.blockTime = new promClient.Gauge({
      name: 'xdc_block_time',
      help: 'Time between blocks in seconds',
      registers: [this.register],
    });

    this.alertCount = new promClient.Counter({
      name: 'xdc_alert_count',
      help: 'Count of alerts by type and component',
      labelNames: ['type', 'component'],
    });
  }

  onModuleInit() {
    this.logger.log('Metrics service initialized');
  }

  getMetrics(): Promise<string> {
    return this.register.metrics();
  }

  setBlockHeight(height: number): void {
    const chainId = this.configService.chainId.toString();
    this.blockHeight.labels(chainId).set(height);
  }

  incrementTransactionCount(status: 'confirmed' | 'pending' | 'failed'): void {
    this.transactionCount.labels(status).inc();
  }

  setTransactionsPerBlock(blockNumber: number, confirmed: number, failed: number): void {
    const blockNumberStr = blockNumber.toString();

    // Reset any existing values for this block to ensure we don't have stale data
    // This is important when refreshing metrics for the same block
    try {
      this.transactionsPerBlock.remove({ block_number: blockNumberStr, status: 'confirmed' });
      this.transactionsPerBlock.remove({ block_number: blockNumberStr, status: 'failed' });
    } catch (error) {
      // Ignore errors if label combination doesn't exist yet
    }

    // Set new values
    if (confirmed >= 0) {
      this.transactionsPerBlock.labels(blockNumberStr, 'confirmed').set(confirmed);
      this.logger.debug(`Set confirmed transactions for block #${blockNumber}: ${confirmed}`);
    }

    if (failed >= 0) {
      this.transactionsPerBlock.labels(blockNumberStr, 'failed').set(failed);
      this.logger.debug(`Set failed transactions for block #${blockNumber}: ${failed}`);
    }
  }

  recordRpcLatency(endpoint: string, latencyMs: number): void {
    this.rpcLatency.labels(endpoint).observe(latencyMs);
  }

  setRpcStatus(endpoint: string, isUp: boolean): void {
    this.rpcStatus.labels(endpoint).set(isUp ? 1 : 0);
  }

  setBlockTime(seconds: number): void {
    this.blockTime.set(seconds);
  }

  incrementAlertCount(type: string, component: string): void {
    this.alertCount.labels(type, component).inc();
  }
}
