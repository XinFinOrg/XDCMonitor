import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@config/config.service';
import { MAINNET_CHAIN_ID, PRIMARY_RPC_URLS, RPC_QUALITY_TIERS, TESTNET_CHAIN_ID } from '@common/constants/endpoints';
import { RpcEndpoint } from '@types';

interface EndpointHealth {
  url: string;
  isUp: boolean;
  latency: number;
  lastChecked: number;
  successRate: number;
  failureCount: number;
  tier: number;
  syncedWithNetwork: boolean;
  blocksBehind: number;
}

/**
 * Service for dynamically selecting the best RPC endpoints
 * based on real-time health metrics and historical performance
 */
@Injectable()
export class RpcSelectorService {
  private readonly logger = new Logger(RpcSelectorService.name);

  // Track health status of each endpoint by chain
  private endpointHealth: Map<number, Map<string, EndpointHealth>> = new Map();

  // Currently selected primary endpoints by chain
  private selectedPrimary: Map<number, string> = new Map();

  // Store the last time we switched primary endpoints to avoid rapid toggling
  private lastSwitchTime: Map<number, number> = new Map();

  // Minimum time between primary endpoint switches (5 minutes)
  private readonly MIN_SWITCH_INTERVAL_MS = 5 * 60 * 1000;

  // Minimum threshold for considering an endpoint "good" (ms)
  private readonly GOOD_LATENCY_THRESHOLD = 1000;

  // Maximum block height difference to consider an endpoint in sync
  private readonly MAX_BLOCKS_BEHIND = 50;

  constructor(private readonly configService: ConfigService) {
    // Initialize with supported chain IDs
    this.initializeForChain(MAINNET_CHAIN_ID);
    this.initializeForChain(TESTNET_CHAIN_ID);
  }

  /**
   * Initialize health tracking for a specific chain ID
   */
  private initializeForChain(chainId: number): void {
    if (!this.endpointHealth.has(chainId)) {
      this.endpointHealth.set(chainId, new Map());
      this.selectedPrimary.set(chainId, PRIMARY_RPC_URLS[chainId]);
      this.lastSwitchTime.set(chainId, 0);
      this.logger.log(`Initialized RPC selector for chain ${chainId}`);
    }
  }

  /**
   * Update the health status of an RPC endpoint
   */
  updateEndpointHealth(
    endpoint: RpcEndpoint,
    isUp: boolean,
    latency: number,
    syncedWithNetwork = true,
    blocksBehind = 0,
  ): void {
    const { url, chainId } = endpoint;
    const chainMap = this.getChainMap(chainId);

    // Get current health or initialize new record
    const currentHealth = chainMap.get(url) || {
      url,
      isUp: true,
      latency: 0,
      lastChecked: 0,
      successRate: 1.0,
      failureCount: 0,
      tier: RPC_QUALITY_TIERS.UNKNOWN,
      syncedWithNetwork: true,
      blocksBehind: 0,
    };

    // Update stats
    const now = Date.now();

    // Calculate success rate with exponential decay (recent checks have more weight)
    const timeWeight = Math.min(1.0, (now - currentHealth.lastChecked) / (24 * 60 * 60 * 1000));
    const decayFactor = 0.9; // How much historical data affects current rate

    let newSuccessRate = currentHealth.successRate;
    if (currentHealth.lastChecked > 0) {
      // Skip first update
      newSuccessRate =
        currentHealth.successRate * (1 - timeWeight * decayFactor) + (isUp ? 1.0 : 0.0) * timeWeight * decayFactor;
    }

    // Update failure tracking
    const failureCount = isUp ? 0 : currentHealth.failureCount + 1;

    // Determine tier based on health metrics
    let tier = currentHealth.tier;
    if (failureCount > 3) {
      tier = RPC_QUALITY_TIERS.LOW;
    } else if (isUp && latency < this.GOOD_LATENCY_THRESHOLD && syncedWithNetwork) {
      // Only promote tier if endpoint is consistently good
      if (newSuccessRate > 0.95 && currentHealth.tier !== RPC_QUALITY_TIERS.HIGH) {
        tier = RPC_QUALITY_TIERS.HIGH;
      } else if (newSuccessRate > 0.85 && currentHealth.tier < RPC_QUALITY_TIERS.MEDIUM) {
        tier = RPC_QUALITY_TIERS.MEDIUM;
      }
    }

    // Update health record
    chainMap.set(url, {
      url,
      isUp,
      latency,
      lastChecked: now,
      successRate: newSuccessRate,
      failureCount,
      tier,
      syncedWithNetwork,
      blocksBehind,
    });

    // Check if we need to switch primary endpoints
    this.checkAndUpdatePrimary(chainId);
  }

  /**
   * Update an endpoint's sync status with the network
   */
  updateEndpointSyncStatus(endpoint: RpcEndpoint, syncedWithNetwork: boolean, blocksBehind: number): void {
    const { url, chainId } = endpoint;
    const chainMap = this.getChainMap(chainId);

    if (chainMap.has(url)) {
      const currentHealth = chainMap.get(url);
      chainMap.set(url, {
        ...currentHealth,
        syncedWithNetwork,
        blocksBehind,
      });

      // Check if primary needs to be updated
      this.checkAndUpdatePrimary(chainId);
    }
  }

  /**
   * Get the current primary RPC URL for a chain
   */
  getPrimaryRpcUrl(chainId: number): string {
    // If we have a selected primary, use it
    if (this.selectedPrimary.has(chainId)) {
      return this.selectedPrimary.get(chainId);
    }

    // Otherwise use the default fallback
    return PRIMARY_RPC_URLS[chainId] || PRIMARY_RPC_URLS[MAINNET_CHAIN_ID];
  }

  /**
   * Check if we need to update the primary endpoint and do so if needed
   */
  private checkAndUpdatePrimary(chainId: number): void {
    const now = Date.now();
    const lastSwitch = this.lastSwitchTime.get(chainId) || 0;

    // Don't switch too frequently
    if (now - lastSwitch < this.MIN_SWITCH_INTERVAL_MS) {
      return;
    }

    const currentPrimary = this.selectedPrimary.get(chainId);
    const chainMap = this.getChainMap(chainId);

    // Check if current primary is having issues
    const currentHealth = chainMap.get(currentPrimary);
    const hasPrimaryIssues =
      !currentHealth ||
      !currentHealth.isUp ||
      !currentHealth.syncedWithNetwork ||
      currentHealth.blocksBehind > this.MAX_BLOCKS_BEHIND ||
      currentHealth.latency > 5000 ||
      currentHealth.failureCount > 2;

    // Only look for a better endpoint if we have issues or it's been a while
    if (!hasPrimaryIssues && now - lastSwitch < this.MIN_SWITCH_INTERVAL_MS * 6) {
      return;
    }

    // Find best alternative
    const bestEndpoint = this.findBestEndpoint(chainId);

    // If we found a better endpoint and it's different from current
    if (bestEndpoint && bestEndpoint !== currentPrimary) {
      this.logger.log(`Switching primary RPC for chain ${chainId} from ${currentPrimary} to ${bestEndpoint}`);

      this.selectedPrimary.set(chainId, bestEndpoint);
      this.lastSwitchTime.set(chainId, now);
    }
  }

  /**
   * Find the best endpoint for a chain based on health metrics
   */
  private findBestEndpoint(chainId: number): string {
    const chainMap = this.getChainMap(chainId);
    let bestUrl = null;
    let bestScore = -1;

    // Default to fallback if nothing better is found
    if (PRIMARY_RPC_URLS[chainId]) {
      bestUrl = PRIMARY_RPC_URLS[chainId];
    }

    // Score each endpoint
    for (const [url, health] of chainMap.entries()) {
      // Skip endpoints that are down or out of sync
      if (!health.isUp || !health.syncedWithNetwork || health.blocksBehind > this.MAX_BLOCKS_BEHIND) {
        continue;
      }

      // Calculate score based on multiple factors
      // Lower latency is better, higher success rate is better, higher tier is better
      const latencyScore = Math.max(0, 1 - health.latency / 5000); // 0-1 score, 0 if latency > 5000ms
      const syncScore = Math.max(0, 1 - health.blocksBehind / this.MAX_BLOCKS_BEHIND); // 0-1 score
      const tierBonus = health.tier * 0.5; // Bonus points for trusted endpoints

      const score = latencyScore * 0.4 + health.successRate * 0.3 + syncScore * 0.2 + tierBonus * 0.1;

      if (score > bestScore) {
        bestScore = score;
        bestUrl = url;
      }
    }

    return bestUrl;
  }

  /**
   * Get health metrics for all endpoints on a chain
   */
  getEndpointHealthForChain(chainId: number): EndpointHealth[] {
    const chainMap = this.getChainMap(chainId);
    return Array.from(chainMap.values());
  }

  /**
   * Get the chain-specific health map, initializing if needed
   */
  private getChainMap(chainId: number): Map<string, EndpointHealth> {
    if (!this.endpointHealth.has(chainId)) {
      this.initializeForChain(chainId);
    }
    return this.endpointHealth.get(chainId);
  }
}
