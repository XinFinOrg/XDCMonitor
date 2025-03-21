import { DEFAULTS, ENV_VARS, FEATURE_FLAGS, NETWORK } from '@common/constants/config';
import { ConfigurationError } from '@common/utils/error-handler';
import { Injectable, Logger } from '@nestjs/common';
import * as dotenv from 'dotenv';
import * as fs from 'fs';
import { join } from 'path';
import { RpcEndpoint, AlertNotificationConfig, MonitoringConfig, InfluxDbConfig } from '@types';
import {
  EXPLORER_ENDPOINTS,
  FAUCET_ENDPOINTS,
  MAINNET_CHAIN_ID,
  PRIMARY_RPC_URLS,
  RPC_ENDPOINTS,
  WS_ENDPOINTS,
} from '@common/constants/endpoints';

/**
 * Configuration service with strict typing and validation
 */
@Injectable()
export class ConfigService {
  private readonly logger = new Logger(ConfigService.name);
  private readonly env: Record<string, string>;
  private isInitialized = false;

  // Cached config values
  private monitoringConfig: MonitoringConfig | null = null;
  private influxDbConfig: InfluxDbConfig | null = null;
  private mainnetRpcEndpoints: string[] | null = null;
  private testnetRpcEndpoints: string[] | null = null;

  constructor() {
    // Load .env file if it exists
    try {
      const envPath = join(process.cwd(), '.env');
      if (fs.existsSync(envPath)) {
        const envConfig = dotenv.parse(fs.readFileSync(envPath));
        this.env = { ...process.env, ...envConfig };
        this.logger.log(`Loaded environment variables from ${envPath}`);
      } else {
        this.env = { ...process.env };
        this.logger.log('No .env file found, using process environment variables');
      }
      this.isInitialized = true;
    } catch (error) {
      this.logger.error(`Failed to load environment variables: ${(error as Error).message}`);
      this.env = { ...process.env };
    }

    // Validate required environment variables
    this.validateRequiredEnvVars();
  }

  /**
   * Get a value from environment variables with type conversion
   */
  get<T>(key: string, defaultValue?: T, transform?: (value: string) => T): T {
    const value = this.env[key];

    if (value === undefined) {
      if (defaultValue !== undefined) {
        return defaultValue;
      }
      throw new ConfigurationError(`Missing required environment variable: ${key}`);
    }

    if (transform) {
      try {
        return transform(value);
      } catch (error) {
        throw new ConfigurationError(
          `Failed to transform environment variable ${key}: ${(error as Error).message}`,
          key,
        );
      }
    }

    return value as unknown as T;
  }

  /**
   * Get a numeric value from environment variables
   */
  getNumber(key: string, defaultValue?: number): number {
    return this.get<number>(key, defaultValue, value => {
      const num = Number(value);
      if (isNaN(num)) {
        throw new Error(`Cannot convert "${value}" to a number`);
      }
      return num;
    });
  }

  /**
   * Get a boolean value from environment variables
   */
  getBoolean(key: string, defaultValue?: boolean): boolean {
    return this.get<boolean>(key, defaultValue, value => {
      if (value.toLowerCase() === 'true' || value === '1') return true;
      if (value.toLowerCase() === 'false' || value === '0') return false;
      throw new Error(`Cannot convert "${value}" to a boolean`);
    });
  }

  /**
   * Get an array value from environment variables (comma-separated string)
   */
  getArray(key: string, defaultValue?: string[]): string[] {
    return this.get<string[]>(key, defaultValue, value =>
      value
        .split(',')
        .map(item => item.trim())
        .filter(Boolean),
    );
  }

  /**
   * Get feature flag status
   */
  isFeatureEnabled(featureFlag: string, defaultValue = false): boolean {
    return this.getBoolean(featureFlag, defaultValue);
  }

  /**
   * Get the application port
   */
  getPort(): number {
    return this.getNumber(ENV_VARS.PORT, DEFAULTS.PORT);
  }

  /**
   * Get the log level
   */
  getLogLevel(): string {
    return this.get(ENV_VARS.LOG_LEVEL, DEFAULTS.LOG_LEVEL);
  }

  /**
   * Get main network RPC endpoints
   */
  getMainnetRpcEndpoints(): string[] {
    if (!this.mainnetRpcEndpoints) {
      this.mainnetRpcEndpoints = this.getArray(ENV_VARS.MAINNET_RPC_ENDPOINTS, []);

      if (this.mainnetRpcEndpoints.length === 0) {
        this.logger.warn('No mainnet RPC endpoints configured');
      }
    }
    return this.mainnetRpcEndpoints;
  }

  /**
   * Get test network RPC endpoints
   */
  getTestnetRpcEndpoints(): string[] {
    if (!this.testnetRpcEndpoints) {
      this.testnetRpcEndpoints = this.getArray(ENV_VARS.TESTNET_RPC_ENDPOINTS, []);

      if (this.testnetRpcEndpoints.length === 0) {
        this.logger.warn('No testnet RPC endpoints configured');
      }
    }
    return this.testnetRpcEndpoints;
  }

  /**
   * Get all monitoring configuration in one object
   */
  getMonitoringConfig(): MonitoringConfig {
    if (!this.monitoringConfig) {
      const alertNotifications: AlertNotificationConfig = {
        webhookUrl: this.get(ENV_VARS.ALERT_WEBHOOK_URL, undefined),
        telegramBotToken: this.get(ENV_VARS.TELEGRAM_BOT_TOKEN, undefined),
        telegramChatId: this.get(ENV_VARS.TELEGRAM_CHAT_ID, undefined),
        enableWebhook: this.isFeatureEnabled(FEATURE_FLAGS.ENABLE_WEBHOOK_NOTIFICATIONS, false),
        enableTelegram: this.getBoolean('ENABLE_CHAT_NOTIFICATIONS', false),
        enableDashboard: this.getBoolean('ENABLE_DASHBOARD_ALERTS', true),
      };

      this.monitoringConfig = {
        scanIntervalMs: this.getNumber(ENV_VARS.SCAN_INTERVAL, DEFAULTS.SCAN_INTERVAL) * 1000,
        blocksToScan: this.getNumber(ENV_VARS.BLOCKS_TO_SCAN, DEFAULTS.BLOCKS_TO_SCAN),
        enableBlocksMonitoring: this.isFeatureEnabled(FEATURE_FLAGS.ENABLE_BLOCK_MONITORING, true),
        enableTransactionsMonitoring: this.isFeatureEnabled(FEATURE_FLAGS.ENABLE_TRANSACTION_MONITORING, true),
        enableRpcMonitoring: this.isFeatureEnabled(FEATURE_FLAGS.ENABLE_RPC_MONITORING, true),
        enableMetricsCollection: this.isFeatureEnabled(FEATURE_FLAGS.ENABLE_METRICS_COLLECTION, true),
        enableAlerts: this.getBoolean('ENABLE_DASHBOARD_ALERTS', true),
        alertNotifications,
        slowRpcThresholdMs: this.getNumber(ENV_VARS.SLOW_RPC_THRESHOLD_MS, DEFAULTS.SLOW_RPC_THRESHOLD_MS),
        blockDiscrepancySyncThreshold: this.getNumber(
          ENV_VARS.BLOCK_DISCREPANCY_SYNC_THRESHOLD,
          DEFAULTS.BLOCK_DISCREPANCY_SYNC_THRESHOLD,
        ),
        transactionHistoryWindowMs: this.getNumber(
          ENV_VARS.TRANSACTION_HISTORY_WINDOW_MS,
          DEFAULTS.TRANSACTION_HISTORY_WINDOW_MS,
        ),
      };
    }

    return this.monitoringConfig;
  }

  /**
   * Get InfluxDB configuration
   */
  getInfluxDbConfig(): InfluxDbConfig {
    if (!this.influxDbConfig) {
      this.influxDbConfig = {
        url: this.get(ENV_VARS.INFLUXDB_URL, DEFAULTS.INFLUXDB_URL),
        token: this.get(ENV_VARS.INFLUXDB_TOKEN, ''),
        org: this.get(ENV_VARS.INFLUXDB_ORG, DEFAULTS.INFLUXDB_ORG),
        bucket: this.get(ENV_VARS.INFLUXDB_BUCKET, DEFAULTS.INFLUXDB_BUCKET),
        enabled: this.isFeatureEnabled(FEATURE_FLAGS.ENABLE_INFLUXDB, false),
        adminUser: this.get(ENV_VARS.INFLUXDB_ADMIN_USER, 'admin'),
        adminPassword: this.get(ENV_VARS.INFLUXDB_ADMIN_PASSWORD, ''),
      };

      // Disable InfluxDB if token is not provided
      if (!this.influxDbConfig.token && this.influxDbConfig.enabled) {
        this.logger.warn('InfluxDB is enabled but no token is provided, disabling InfluxDB');
        this.influxDbConfig.enabled = false;
      }
    }

    return this.influxDbConfig;
  }

  /**
   * Get network configuration by chain ID
   */
  getNetworkNameByChainId(chainId: number): string {
    if (chainId === NETWORK.MAINNET_CHAIN_ID) {
      return NETWORK.MAINNET;
    } else if (chainId === NETWORK.TESTNET_CHAIN_ID) {
      return NETWORK.TESTNET;
    }
    throw new ConfigurationError(`Unknown chain ID: ${chainId}`, 'chainId');
  }

  /**
   * Get RPC endpoints by network name
   */
  getRpcEndpointsByNetwork(network: string): string[] {
    if (network === NETWORK.MAINNET) {
      return this.getMainnetRpcEndpoints();
    } else if (network === NETWORK.TESTNET) {
      return this.getTestnetRpcEndpoints();
    }
    throw new ConfigurationError(`Unknown network: ${network}`, 'network');
  }

  /**
   * Validate that required environment variables are present
   */
  private validateRequiredEnvVars(): void {
    // Add validation for required environment variables
    const requiredVars: string[] = [];

    // If any are missing, log warnings
    const missingVars = requiredVars.filter(key => !this.env[key]);
    if (missingVars.length > 0) {
      this.logger.warn(`Missing required environment variables: ${missingVars.join(', ')}`);
    }
  }

  /**
   * Get the primary RPC URL for a specific chain ID
   */
  getPrimaryRpcUrl(chainId: number): string {
    return PRIMARY_RPC_URLS[chainId] || PRIMARY_RPC_URLS[MAINNET_CHAIN_ID];
  }

  /**
   * Get all RPC endpoints
   */
  getRpcEndpoints(): RpcEndpoint[] {
    return RPC_ENDPOINTS;
  }

  /**
   * Get all WebSocket endpoints
   */
  getWsEndpoints(): RpcEndpoint[] {
    // Filter out conditional WS endpoints if not enabled
    return WS_ENDPOINTS.filter(
      endpoint => (endpoint as any).conditional !== true || this.getBoolean('ENABLE_ADDITIONAL_WS_ENDPOINTS', false),
    );
  }

  /**
   * Get block monitoring enabled status
   */
  get enableBlockMonitoring(): boolean {
    return this.getMonitoringConfig().enableBlocksMonitoring;
  }

  /**
   * Get transaction monitoring enabled status
   */
  get enableTransactionMonitoring(): boolean {
    return this.getMonitoringConfig().enableTransactionsMonitoring;
  }

  /**
   * Get RPC monitoring enabled status
   */
  get enableRpcMonitoring(): boolean {
    return this.getMonitoringConfig().enableRpcMonitoring;
  }

  /**
   * Get port monitoring enabled status
   */
  get enablePortMonitoring(): boolean {
    return this.isFeatureEnabled('ENABLE_PORT_MONITORING', false);
  }

  /**
   * Get scan interval in milliseconds
   */
  get scanInterval(): number {
    return this.getMonitoringConfig().scanIntervalMs;
  }

  /**
   * Get test receiver address for a chain
   */
  getTestReceiverAddress(chainId: string): string {
    return (
      this.get(`TEST_RECEIVER_ADDRESS_${chainId}`, undefined) ||
      this.get('TEST_RECEIVER_ADDRESS', '0x0000000000000000000000000000000000000000')
    );
  }

  /**
   * Get mainnet test private key
   */
  get mainnetTestPrivateKey(): string {
    return this.get('MAINNET_TEST_PRIVATE_KEY', '');
  }

  /**
   * Get testnet test private key
   */
  get testnetTestPrivateKey(): string {
    return this.get('TESTNET_TEST_PRIVATE_KEY', '');
  }

  /**
   * Get explorer endpoints
   */
  get explorerEndpoints(): RpcEndpoint[] {
    return EXPLORER_ENDPOINTS;
  }

  /**
   * Get faucet endpoints
   */
  get faucetEndpoints(): RpcEndpoint[] {
    return FAUCET_ENDPOINTS;
  }

  /**
   * Get Grafana admin credentials
   */
  getGrafanaAdminCredentials(): { user: string; password: string } {
    return {
      user: this.get(ENV_VARS.GRAFANA_ADMIN_USER, 'admin'),
      password: this.get(ENV_VARS.GRAFANA_ADMIN_PASSWORD, 'admin'),
    };
  }

  /**
   * Get block time threshold
   */
  get blockTimeThreshold(): number {
    return this.getNumber('BLOCK_TIME_THRESHOLD', 5);
  }
}
