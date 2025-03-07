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

  recordRpcLatency(endpoint: string, latencyMs: number): void {
    this.rpcLatency.labels(endpoint).observe(latencyMs);
  }

  setRpcStatus(endpoint: string, isUp: boolean): void {
    this.rpcStatus.labels(endpoint).set(isUp ? 1 : 0);
  }

  setBlockTime(seconds: number): void {
    this.blockTime.set(seconds);
  }
}
