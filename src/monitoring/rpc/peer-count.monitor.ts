import { AlertService } from '@alerts/alert.service';
import { ALERTS } from '@common/constants/config';
import { RpcRetryClient } from '@common/utils/rpc-retry-client';
import { MetricsService } from '@metrics/metrics.service';
import { Injectable, Logger } from '@nestjs/common';
import { PeerCountBaseline, RpcEndpoint } from '@types';
import WebSocket from 'ws';

/**
 * Service for adaptive peer count monitoring with dynamic baselines
 */
@Injectable()
export class PeerCountMonitor {
  private readonly logger = new Logger(PeerCountMonitor.name);

  // Map of endpoint URL to its baseline data
  private peerCountBaselines = new Map<string, PeerCountBaseline>();

  // Cache of RPC clients to avoid recreating them
  private rpcClients = new Map<string, RpcRetryClient>();

  // Configuration constants
  private readonly MIN_SAMPLES_FOR_BASELINE = 5; // Minimum samples needed for a valid baseline
  private readonly ALERT_BACKOFF_INITIAL_MS = 30 * 60 * 1000; // 30 minutes
  private readonly ALERT_HISTORY_RETENTION_MS = 24 * 60 * 60 * 1000; // 24 hours
  private readonly CONSECUTIVE_ZEROS_THRESHOLD = 3; // Need 3 consecutive zeros to trigger an alert

  // Proportional threshold configuration
  private readonly SIGNIFICANT_RELATIVE_DROP_THRESHOLD = 0.4; // 40% drop from baseline triggers alert
  private readonly CRITICAL_RELATIVE_DROP_THRESHOLD = 0.7; // 70% drop from baseline (critical)
  private readonly SIGNIFICANT_ABSOLUTE_DROP_FACTOR = 0.2; // 20% of baseline for absolute drop threshold
  private readonly MIN_ABSOLUTE_DROP_THRESHOLD = 4; // Minimum drop to consider significant (for low peer counts)
  private readonly HIGH_PEER_COUNT_FACTOR = 2.0; // 2x baseline to be considered "high peer" endpoint
  private readonly MIN_HIGH_PEER_THRESHOLD = 8; // Minimum peers to be considered "high peer" endpoint
  private readonly CRITICAL_BASELINE_THRESHOLD = 5; // Baseline above which low peers are critical

  constructor(
    private readonly metricsService: MetricsService,
    private readonly alertService: AlertService,
  ) {}

  /**
   * Monitor peer count for an RPC endpoint
   *
   * @param endpoint The RPC endpoint to check
   * @returns True if an alert was fired, false otherwise
   */
  public async monitorRpcPeerCount(endpoint: RpcEndpoint): Promise<boolean> {
    const peerCount = await this.fetchRpcPeerCount(endpoint);
    if (peerCount === null) {
      // Write sentinel value for failed endpoint to maintain visibility in Grafana
      this.metricsService.setPeerCountWithSentinel(endpoint.url, null, 'rpc', endpoint.chainId, true);
      return false;
    }

    return this.processPeerCountWithMetrics(endpoint, peerCount, 'rpc');
  }

  /**
   * Monitor peer count for a WebSocket endpoint
   *
   * @param endpoint The WebSocket endpoint to check
   * @returns True if an alert was fired, false otherwise
   */
  public async monitorWsPeerCount(endpoint: RpcEndpoint): Promise<boolean> {
    const peerCount = await this.fetchWsPeerCount(endpoint);
    if (peerCount === null) return false;

    return this.processPeerCountWithMetrics(endpoint, peerCount, 'websocket');
  }

  /**
   * Process peer count with metrics recording and logging
   */
  private processPeerCountWithMetrics(
    endpoint: RpcEndpoint,
    peerCount: number,
    endpointType: 'rpc' | 'websocket',
  ): boolean {
    this.metricsService.setPeerCountWithSentinel(endpoint.url, peerCount, endpointType, endpoint.chainId, false);
    const alertTriggered = this.processPeerCount(endpoint, peerCount, endpointType);

    const logLevel = alertTriggered ? 'log' : 'debug';
    const statusText = alertTriggered ? '(critical)' : '(normal)';
    this.logger[logLevel](
      `${endpointType === 'rpc' ? 'RPC' : 'WebSocket'} endpoint ${endpoint.url} has ${peerCount} peers ${statusText}`,
    );

    return alertTriggered;
  }

  /**
   * Process a peer count reading and update baselines
   *
   * @param endpoint The endpoint that was checked
   * @param peerCount The peer count that was observed
   * @param endpointType Type of endpoint (rpc or websocket)
   * @returns True if an alert was fired, false otherwise
   */
  public processPeerCount(endpoint: RpcEndpoint, peerCount: number, endpointType: 'rpc' | 'websocket'): boolean {
    const { url, chainId } = endpoint;

    // Get current baseline or create a new one
    const baseline = this.peerCountBaselines.get(url) ?? this.createNewBaseline(url, endpointType, chainId);
    this.peerCountBaselines.set(url, baseline);

    // Update baseline with new peer count data
    this.updateBaseline(baseline, peerCount);

    // Check if we need to alert
    return this.checkForAlert(endpoint, baseline, peerCount, endpointType);
  }

  /**
   * Create a new baseline entry for an endpoint
   */
  private createNewBaseline(
    endpointUrl: string,
    endpointType: 'rpc' | 'websocket',
    chainId: number,
  ): PeerCountBaseline {
    this.logger.debug(`Creating new peer count baseline for ${endpointUrl}`);

    return {
      endpointUrl,
      endpointType,
      chainId,
      baselinePeerCount: 0,
      previousPeerCount: 0,
      highestPeerCount: 0,
      sampleCount: 0,
      recentAlerts: [],
      lastUpdated: Date.now(),
      typicallyHasPeers: false,
      consecutiveZeros: 0,
    };
  }

  /**
   * Update a baseline with a new peer count sample
   */
  private updateBaseline(baseline: PeerCountBaseline, peerCount: number): void {
    const now = Date.now();

    // Store previous peer count before updating
    baseline.previousPeerCount = baseline.sampleCount > 0 ? baseline.baselinePeerCount : peerCount;

    // Update highest peer count observed
    if (peerCount > baseline.highestPeerCount) {
      baseline.highestPeerCount = peerCount;
    }

    // Update tracking counters
    baseline.consecutiveZeros = peerCount === 0 ? baseline.consecutiveZeros + 1 : 0;
    baseline.recentAlerts = baseline.recentAlerts.filter(
      timestamp => now - timestamp < this.ALERT_HISTORY_RETENTION_MS,
    );

    // Update the baseline calculation
    if (baseline.sampleCount < this.MIN_SAMPLES_FOR_BASELINE) {
      // Build initial baseline (weighted average)
      baseline.baselinePeerCount =
        (baseline.baselinePeerCount * baseline.sampleCount + peerCount) / (baseline.sampleCount + 1);
      baseline.sampleCount++;
    } else {
      // Gradual adjustment (10% weight to new sample)
      baseline.baselinePeerCount = baseline.baselinePeerCount * 0.9 + peerCount * 0.1;
      // Update whether this endpoint typically has peers
      baseline.typicallyHasPeers = baseline.baselinePeerCount > 0.5;
    }

    baseline.lastUpdated = now;
  }

  /**
   * Calculate the dynamic absolute drop threshold based on baseline
   * Uses a percentage of the baseline but ensures a minimum drop threshold
   * @param baseline The baseline peer count
   * @returns The absolute drop threshold (number of peers)
   */
  private calculateAbsoluteDropThreshold(baseline: number): number {
    // Calculate threshold as percentage of baseline (minimum 4)
    return Math.max(Math.ceil(baseline * this.SIGNIFICANT_ABSOLUTE_DROP_FACTOR), this.MIN_ABSOLUTE_DROP_THRESHOLD);
  }

  /**
   * Calculate the dynamic high peer threshold based on baseline
   * Uses a multiplier of the baseline but ensures a minimum threshold
   * @param baseline The baseline peer count
   * @returns The high peer threshold (number of peers)
   */
  private calculateHighPeerThreshold(baseline: number): number {
    // Calculate threshold as multiplier of baseline (minimum 8)
    return Math.max(Math.ceil(baseline * this.HIGH_PEER_COUNT_FACTOR), this.MIN_HIGH_PEER_THRESHOLD);
  }

  /**
   * Format an alert message based on alert type and context
   */
  private formatAlertMessage(
    endpoint: RpcEndpoint,
    currentPeerCount: number,
    alertType: string,
    baselinePeerCount: number,
    highestPeerCount: number,
    absoluteDropThreshold?: number,
  ): string {
    const { name, url: endpointUrl } = endpoint;
    const formattedBaseline = baselinePeerCount.toFixed(1);

    if (alertType === ALERTS.TYPES.RPC_NO_PEERS) {
      return (
        `${name} (${endpointUrl}) has zero peers, which is critical. ` +
        `Normal baseline is ${formattedBaseline} peers.`
      );
    }

    if (baselinePeerCount > 2 && currentPeerCount <= 1) {
      return (
        `${name} (${endpointUrl}) has ${currentPeerCount} peers, ` +
        `which is significantly below its normal baseline of ${formattedBaseline} peers.`
      );
    }

    const relativeDropPercentage = (baselinePeerCount - currentPeerCount) / baselinePeerCount;
    if (
      baselinePeerCount > 2 &&
      currentPeerCount > 1 &&
      relativeDropPercentage >= this.CRITICAL_RELATIVE_DROP_THRESHOLD
    ) {
      const dropPercentage = (relativeDropPercentage * 100).toFixed(1);
      return (
        `${name} (${endpointUrl}) has experienced a critical peer count drop. ` +
        `Current: ${currentPeerCount} peers (${dropPercentage}% below baseline of ${formattedBaseline}).`
      );
    }

    // For absolute drop alert
    const absDropCount = highestPeerCount - currentPeerCount;
    return (
      `${name} (${endpointUrl}) peer count has dropped by ${absDropCount} peers ` +
      `(threshold: ${absoluteDropThreshold}). Current: ${currentPeerCount}, Previous high: ${highestPeerCount}.`
    );
  }

  /**
   * Check if the current peer count should trigger an alert
   */
  private checkForAlert(
    endpoint: RpcEndpoint,
    baseline: PeerCountBaseline,
    currentPeerCount: number,
    endpointType: 'rpc' | 'websocket',
  ): boolean {
    const { baselinePeerCount, typicallyHasPeers, sampleCount, chainId, highestPeerCount } = baseline;

    // Don't alert if we don't have enough samples yet or endpoint doesn't typically have peers
    if (sampleCount < this.MIN_SAMPLES_FOR_BASELINE || !typicallyHasPeers) return false;

    // Calculate dynamic thresholds based on baseline
    const absoluteDropThreshold = this.calculateAbsoluteDropThreshold(baselinePeerCount);
    const highPeerThreshold = this.calculateHighPeerThreshold(baselinePeerCount);

    // Determine alert type and check conditions
    let alertType = '';
    let isCritical = false;

    // Zero peers is most critical - alert after consecutive zero readings
    if (currentPeerCount === 0 && baseline.consecutiveZeros >= this.CONSECUTIVE_ZEROS_THRESHOLD) {
      alertType = ALERTS.TYPES.RPC_NO_PEERS;
      isCritical = true;
    }
    // Critical low peer count (1 or 0) for endpoints that should have more
    else if (baselinePeerCount > this.CRITICAL_BASELINE_THRESHOLD && currentPeerCount <= 1) {
      alertType = ALERTS.TYPES.RPC_LOW_PEERS;
      isCritical = true;
    }
    // Check for significant drop in peer count as a percentage
    else if (
      baselinePeerCount > 2 &&
      currentPeerCount > 1 &&
      (baselinePeerCount - currentPeerCount) / baselinePeerCount >= this.CRITICAL_RELATIVE_DROP_THRESHOLD
    ) {
      alertType = ALERTS.TYPES.RPC_LOW_PEERS;
      isCritical = true;
    }
    // Check for significant absolute drop in peer count for high-peer endpoints
    else if (
      highestPeerCount >= highPeerThreshold &&
      highestPeerCount - currentPeerCount >= absoluteDropThreshold * 2
    ) {
      alertType = ALERTS.TYPES.RPC_LOW_PEERS;
      isCritical = true;
    }

    // If no critical alert needed or throttled, return false
    if (!alertType || !isCritical || this.isAlertThrottled(baseline)) return false;

    // Record this alert
    baseline.recentAlerts.push(Date.now());

    // Format and send alert only for critical issues
    const alertMessage = this.formatAlertMessage(
      endpoint,
      currentPeerCount,
      alertType,
      baselinePeerCount,
      highestPeerCount,
      absoluteDropThreshold,
    );

    const componentType = endpointType === 'rpc' ? ALERTS.COMPONENTS.RPC : ALERTS.COMPONENTS.WEBSOCKET;
    this.alertService.error(alertType, componentType, alertMessage, chainId);

    return true;
  }

  /**
   * Check if alerts for this endpoint should be throttled using exponential backoff
   */
  private isAlertThrottled(baseline: PeerCountBaseline): boolean {
    const { recentAlerts } = baseline;
    if (recentAlerts.length === 0) return false;

    // Calculate backoff time: initial time * 2^(alertCount-1)
    const alertCount = recentAlerts.length;
    const backoffTime = this.ALERT_BACKOFF_INITIAL_MS * Math.pow(2, alertCount - 1);

    // Check if enough time has elapsed since most recent alert
    return Date.now() - Math.max(...recentAlerts) < backoffTime;
  }

  /**
   * Fetch peer count from an HTTP RPC endpoint
   *
   * @param endpoint The RPC endpoint to check
   * @returns The number of peers or null if the request failed
   */
  private async fetchRpcPeerCount(endpoint: RpcEndpoint): Promise<number | null> {
    try {
      // Get or create RPC client
      let client = this.rpcClients.get(endpoint.url);
      if (!client) {
        client = new RpcRetryClient(endpoint.url);
        this.rpcClients.set(endpoint.url, client);
      }

      // Call net_peerCount method
      const peerCountHex = await client.call<string>('net_peerCount', [], { timeoutMs: 5000 });

      // Convert hex response to number
      return peerCountHex && typeof peerCountHex === 'string' ? parseInt(peerCountHex, 16) : null;
    } catch (error) {
      this.logger.debug(`Error fetching peer count from ${endpoint.url}: ${error.message}`);
      return null;
    }
  }

  /**
   * Fetch peer count from a WebSocket endpoint
   *
   * @param endpoint The WebSocket endpoint to check
   * @returns The number of peers or null if the request failed
   */
  private async fetchWsPeerCount(endpoint: RpcEndpoint): Promise<number | null> {
    return new Promise<number | null>(resolve => {
      try {
        const ws = new WebSocket(endpoint.url);
        let isResolved = false;

        // Set timeout to avoid hanging connections
        const timeout = setTimeout(() => {
          if (!isResolved) {
            isResolved = true;
            ws.terminate();
            this.logger.debug(`WebSocket peer count request timed out for ${endpoint.url}`);
            resolve(null);
          }
        }, 10000);

        const cleanupAndResolve = (value: number | null) => {
          if (isResolved) return;
          clearTimeout(timeout);
          isResolved = true;
          ws.close();
          resolve(value);
        };

        ws.on('open', () => {
          // Send net_peerCount request
          ws.send(
            JSON.stringify({
              jsonrpc: '2.0',
              method: 'net_peerCount',
              params: [],
              id: 1,
            }),
          );
        });

        ws.on('message', data => {
          try {
            const response = JSON.parse(data.toString());
            if (response.result && typeof response.result === 'string') {
              cleanupAndResolve(parseInt(response.result, 16));
            } else {
              cleanupAndResolve(null);
            }
          } catch (error) {
            this.logger.debug(`Error parsing WebSocket response from ${endpoint.url}: ${error.message}`);
            cleanupAndResolve(null);
          }
        });

        ws.on('error', error => {
          this.logger.debug(`WebSocket error when fetching peer count from ${endpoint.url}: ${error.message}`);
          cleanupAndResolve(null);
        });
      } catch (error) {
        this.logger.debug(`Error setting up WebSocket connection to ${endpoint.url}: ${error.message}`);
        resolve(null);
      }
    });
  }
}
