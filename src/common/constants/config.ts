/**
 * Centralized configuration constants for the application
 */

// Blockchain constants
export const BLOCKCHAIN = {
  // Chain IDs
  CHAIN_IDS_STR: {
    MAINNET: '50',
    TESTNET: '51',
  },

  // Chain IDs as numbers
  CHAIN_IDS_NUM: {
    MAINNET: 50,
    TESTNET: 51,
  },

  // RPC endpoints
  RPC: {
    // Default primary RPC endpoints
    DEFAULT_MAINNET_RPC: 'https://rpc.xinfin.network',
    DEFAULT_TESTNET_RPC: 'https://rpc.apothem.network',

    // Default WebSocket endpoints
    DEFAULT_MAINNET_WS: 'wss://ws.xinfin.network',
    DEFAULT_TESTNET_WS: 'wss://ws.apothem.network',

    // RPC methods
    METHODS: {
      GET_BLOCK_NUMBER: 'eth_blockNumber',
      GET_BLOCK_BY_NUMBER: 'eth_getBlockByNumber',
      GET_BLOCK_BY_HASH: 'eth_getBlockByHash',
      GET_TRANSACTION_RECEIPT: 'eth_getTransactionReceipt',
      GET_TRANSACTION_BY_HASH: 'eth_getTransactionByHash',
      SEND_RAW_TRANSACTION: 'eth_sendRawTransaction',
      GET_BALANCE: 'eth_getBalance',
    },
  },

  // Block monitoring
  BLOCKS: {
    // How many blocks to check for missing
    MISSING_BLOCKS_RANGE: 50,

    // How many blocks to keep in memory for analysis
    MAX_RECENT_BLOCKS: 100,

    // Default scan interval in milliseconds
    DEFAULT_SCAN_INTERVAL_MS: 5000,

    // Block time thresholds in seconds (only critical threshold)
    BLOCK_TIME_ERROR_THRESHOLD: 10, // 10 seconds
  },
};

// Feature flags
export const FEATURE_FLAGS = {
  // Monitoring feature flags
  ENABLE_BLOCK_MONITORING: 'ENABLE_BLOCK_MONITORING',
  ENABLE_TRANSACTION_MONITORING: 'ENABLE_TRANSACTION_MONITORING',
  ENABLE_RPC_MONITORING: 'ENABLE_RPC_MONITORING',
  ENABLE_PORT_MONITORING: 'ENABLE_PORT_MONITORING',
  ENABLE_METRICS_COLLECTION: 'ENABLE_METRICS_COLLECTION',
  ENABLE_CONSENSUS_MONITORING: 'ENABLE_CONSENSUS_MONITORING',

  // Alert feature flags
  ENABLE_DASHBOARD_ALERTS: 'ENABLE_DASHBOARD_ALERTS',
  ENABLE_CHAT_NOTIFICATIONS: 'ENABLE_CHAT_NOTIFICATIONS',

  // Dashboard feature flags
  ENABLE_DASHBOARD: 'ENABLE_DASHBOARD',
  ENABLE_WEBSOCKET_UPDATES: 'ENABLE_WEBSOCKET_UPDATES',

  // Storage feature flags
  ENABLE_INFLUXDB: 'ENABLE_INFLUXDB',

  // Notification feature flags
  ENABLE_WEBHOOK_NOTIFICATIONS: 'ENABLE_WEBHOOK_NOTIFICATIONS',
  ENABLE_TELEGRAM_NOTIFICATIONS: 'ENABLE_TELEGRAM_NOTIFICATIONS',
  ENABLE_EMAIL_NOTIFICATIONS: 'ENABLE_EMAIL_NOTIFICATIONS',
} as const;

// Environment variable names
export const ENV_VARS = {
  // General
  NODE_ENV: 'NODE_ENV',
  LOG_LEVEL: 'LOG_LEVEL',
  PORT: 'PORT',

  // RPC Endpoints
  MAINNET_RPC_ENDPOINTS: 'MAINNET_RPC_ENDPOINTS',
  TESTNET_RPC_ENDPOINTS: 'TESTNET_RPC_ENDPOINTS',

  // Monitoring configuration
  SCAN_INTERVAL: 'SCAN_INTERVAL',
  BLOCKS_TO_SCAN: 'BLOCKS_TO_SCAN',
  TRANSACTION_HISTORY_WINDOW_MS: 'TRANSACTION_HISTORY_WINDOW_MS',
  SLOW_RPC_THRESHOLD_MS: 'SLOW_RPC_THRESHOLD_MS',
  BLOCK_DISCREPANCY_SYNC_THRESHOLD: 'BLOCK_DISCREPANCY_SYNC_THRESHOLD',
  ENABLE_RPC_MONITORING: 'ENABLE_RPC_MONITORING',
  ENABLE_PORT_MONITORING: 'ENABLE_PORT_MONITORING',
  ENABLE_BLOCK_MONITORING: 'ENABLE_BLOCK_MONITORING',
  BLOCK_TIME_THRESHOLD: 'BLOCK_TIME_THRESHOLD',
  ENABLE_TRANSACTION_MONITORING: 'ENABLE_TRANSACTION_MONITORING',
  ENABLE_DASHBOARD_ALERTS: 'ENABLE_DASHBOARD_ALERTS',
  ENABLE_CHAT_NOTIFICATIONS: 'ENABLE_CHAT_NOTIFICATIONS',

  // InfluxDB Configuration
  INFLUXDB_URL: 'INFLUXDB_URL',
  INFLUXDB_TOKEN: 'INFLUXDB_TOKEN',
  INFLUXDB_ORG: 'INFLUXDB_ORG',
  INFLUXDB_BUCKET: 'INFLUXDB_BUCKET',
  INFLUXDB_ADMIN_USER: 'INFLUXDB_ADMIN_USER',
  INFLUXDB_ADMIN_PASSWORD: 'INFLUXDB_ADMIN_PASSWORD',

  // Grafana Configuration
  GRAFANA_ADMIN_USER: 'GRAFANA_ADMIN_USER',
  GRAFANA_ADMIN_PASSWORD: 'GRAFANA_ADMIN_PASSWORD',

  // Alert configuration
  ALERT_WEBHOOK_URL: 'NOTIFICATION_WEBHOOK_URL',
  TELEGRAM_BOT_TOKEN: 'TELEGRAM_BOT_TOKEN',
  TELEGRAM_CHAT_ID: 'TELEGRAM_CHAT_ID',
  TELEGRAM_MAINNET_TOPIC_ID: 'TELEGRAM_MAINNET_TOPIC_ID',
  TELEGRAM_TESTNET_TOPIC_ID: 'TELEGRAM_TESTNET_TOPIC_ID',

  // Wallet Configuration
  MNEMONIC_WALLET: 'MNEMONIC_WALLET',
  MAINNET_TEST_PRIVATE_KEY: 'MAINNET_TEST_PRIVATE_KEY',
  TESTNET_TEST_PRIVATE_KEY: 'TESTNET_TEST_PRIVATE_KEY',
  TEST_RECEIVER_ADDRESS_50: 'TEST_RECEIVER_ADDRESS_50',
  TEST_RECEIVER_ADDRESS_51: 'TEST_RECEIVER_ADDRESS_51',

  // Consensus monitoring configuration
  CONSENSUS_MONITORING_CHAIN_IDS: 'CONSENSUS_MONITORING_CHAIN_IDS',
  CONSENSUS_SCAN_INTERVAL: 'CONSENSUS_SCAN_INTERVAL',

  // Healthchecks.io configuration
  HEALTHCHECKS_IO_URL: 'HEALTHCHECKS_IO_URL',
  HEALTHCHECKS_IO_INTERVAL: 'HEALTHCHECKS_IO_INTERVAL',

  // Sentinel values configuration for null data handling
  ENABLE_SENTINEL_VALUES: 'ENABLE_SENTINEL_VALUES',
  SENTINEL_PEER_COUNT: 'SENTINEL_PEER_COUNT',
  SENTINEL_LATENCY: 'SENTINEL_LATENCY',
  SENTINEL_STATUS_DOWN: 'SENTINEL_STATUS_DOWN',
} as const;

// Network related constants
export const NETWORK = {
  MAINNET: 'mainnet',
  TESTNET: 'testnet',

  // Chain IDs
  MAINNET_CHAIN_ID: 50,
  TESTNET_CHAIN_ID: 51,

  // Block time target in seconds
  TARGET_BLOCK_TIME_SECONDS: 2,

  // Maximum number of blocks that can be requested in a single eth_getBlockByNumber batch
  MAX_BLOCKS_BATCH_SIZE: 50,
} as const;

// Default values for configuration
export const DEFAULTS = {
  // General defaults
  PORT: 3000,
  LOG_LEVEL: 'info',

  // Monitoring defaults
  SCAN_INTERVAL: 10, // 10 seconds
  BLOCKS_TO_SCAN: 10,
  TRANSACTION_HISTORY_WINDOW_MS: 3600000, // 1 hour
  SLOW_RPC_THRESHOLD_MS: 1000, // 1 second
  BLOCK_DISCREPANCY_SYNC_THRESHOLD: 5, // 5 blocks
  RECENT_BLOCKS_SAMPLE_SIZE: 100,

  // InfluxDB defaults
  INFLUXDB_URL: 'http://localhost:8086',
  INFLUXDB_ORG: 'xdc',
  INFLUXDB_BUCKET: 'xdc_monitoring',

  // Maximum number of attempts for RPC calls
  RPC_MAX_RETRIES: 3,

  // Maximum number of alerts stored in memory
  MAX_ALERTS_IN_MEMORY: 1000,

  // Default timeouts
  REQUEST_TIMEOUT_MS: 15000, // 15 seconds
  WEBSOCKET_PING_INTERVAL_MS: 30000, // 30 seconds

  // Dashboard update intervals
  DASHBOARD_UPDATE_INTERVAL_MS: 5000, // 5 seconds

  // Sentinel values for null data handling in Grafana
  SENTINEL_PEER_COUNT: -1,
  SENTINEL_LATENCY: -1,
  SENTINEL_STATUS_DOWN: 0,
} as const;

// Time constants in milliseconds for convenience
export const TIME_MS = {
  SECOND: 1000,
  MINUTE: 60 * 1000,
  HOUR: 60 * 60 * 1000,
  DAY: 24 * 60 * 60 * 1000,
  WEEK: 7 * 24 * 60 * 60 * 1000,
} as const;

// Alert thresholds
export const ALERT_THRESHOLDS = {
  // Block monitoring
  MISSED_BLOCKS_CRITICAL: 10,
  BLOCK_TIME_CRITICAL_FACTOR: 5, // 5x target block time

  // RPC monitoring
  RPC_LATENCY_CRITICAL_MS: 5000, // 5 seconds
  RPC_FAILURE_RATE_CRITICAL: 0.3, // 30%

  // Transaction monitoring
  LOW_TRANSACTION_COUNT_CRITICAL_FACTOR: 0.2, // 20% of average
} as const;

// Metric names
export const METRIC_NAMES = {
  // Block metrics
  BLOCK_HEIGHT: 'block_height',
  BLOCK_TIME: 'block_time',
  MISSED_BLOCKS: 'missed_blocks',

  // Transaction metrics
  TRANSACTION_COUNT: 'transaction_count',
  TRANSACTION_RATE: 'transaction_rate',

  // RPC metrics
  RPC_LATENCY: 'rpc_latency',
  RPC_SUCCESS_RATE: 'rpc_success_rate',
  RPC_ERROR_COUNT: 'rpc_error_count',
} as const;

// API endpoint paths
export const API_PATHS = {
  // Health check
  HEALTH: '/health',

  // Blocks related endpoints
  BLOCKS: '/blocks',
  LATEST_BLOCK: '/blocks/latest',
  BLOCK_BY_NUMBER: '/blocks/:number',

  // Transaction related endpoints
  TRANSACTIONS: '/transactions',
  TRANSACTION_BY_HASH: '/transactions/:hash',

  // Monitor related endpoints
  MONITOR_STATUS: '/monitor/status',
  MONITOR_METRICS: '/monitor/metrics',

  // Alert related endpoints
  ALERTS: '/alerts',
  ACKNOWLEDGE_ALERT: '/alerts/:id/acknowledge',

  // Dashboard WebSocket
  DASHBOARD_WEBSOCKET: '/dashboard',
} as const;

// Alert constants
export const ALERTS = {
  // Alert types
  TYPES: {
    THRESHOLD_EXCEEDED: 'threshold_exceeded',
    THRESHOLD_WARNING: 'threshold_warning',
    THRESHOLD_NOTIFICATION: 'threshold_notification',
    RPC_ENDPOINT_DOWN: 'rpc_endpoint_down',
    RPC_HIGH_LATENCY: 'rpc_high_latency',
    RPC_NO_PEERS: 'rpc_no_peers',
    RPC_LOW_PEERS: 'rpc_low_peers',
    MISSING_BLOCKS: 'missing_blocks',
    HIGH_BLOCK_TIME: 'high_block_time',
    TX_FAILURE: 'transaction_failure',
    HIGH_TX_VOLUME: 'high_transaction_volume',
    LOW_TX_VOLUME: 'low_transaction_volume',
    SYNC_BLOCKS_LAG: 'sync_blocks_lag',
    WALLET_LOW_BALANCE: 'wallet_low_balance',
    INSUFFICIENT_WALLET_BALANCE: 'insufficient_wallet_balance',
    TRANSACTION_FAILURE_RATE_HIGH: 'transaction_failure_rate_high',
    CONSENSUS_FREQUENT_MISSED_ROUNDS: 'consensus_frequent_missed_rounds',
    CONSENSUS_UNUSUAL_TIMEOUT: 'consensus_unusual_timeout',
    CONSENSUS_PENALTY_LIST_SIZE_EXCEEDED: 'consensus_penalty_list_size_exceeded',
    CONSENSUS_FREQUENT_PENALTY_NODES: 'consensus_frequent_penalty_nodes',
  },

  // Alert components
  COMPONENTS: {
    RPC: 'rpc',
    WEBSOCKET: 'websocket',
    TRANSACTION: 'transaction',
    BLOCK: 'block',
    SYNC: 'sync',
    CONSENSUS: 'consensus',
  },

  // Alert severities
  SEVERITY: {
    INFO: 'info',
    WARNING: 'warning',
    ERROR: 'error',
  },

  // Thresholds
  THRESHOLDS: {
    // RPC
    RPC_LATENCY_ERROR_MS: 30000, // 30 seconds
    RPC_LATENCY_WARNING_MS: 15000, // 15 seconds

    // Sync
    SYNC_LAG_ERROR_BLOCKS: 100, // 100 blocks
    SYNC_LAG_CRITICAL_BLOCKS: 1000, // 1000 blocks

    // Transaction volume
    TX_VOLUME_LOW_THRESHOLD: 10, // 10 transactions

    // Wallet balance
    MIN_WALLET_BALANCE_XDC: 1, // 1 XDC
  },

  // Notification settings
  NOTIFICATIONS: {
    // Maximum alerts to include in a single message
    MAX_ALERTS_PER_MESSAGE: 10,

    // Minimum duration between same-type alerts (seconds)
    THROTTLE_SECONDS: {
      DEFAULT: 300, // 5 minutes
      RPC_ENDPOINT_DOWN: 600, // 10 minutes
      HIGH_BLOCK_TIME: 900, // 15 minutes
      SYNC_BLOCKS_LAG: 3600, // 1 hour (both AlertService and BlocksMonitorService use this)
      SYNC_BLOCKS_LAG_MANY_ENDPOINTS: 3600, // 1 hours (when many endpoints are affected)
    },
  },
};

// Performance and resource tuning
export const PERFORMANCE = {
  // Queue processing
  QUEUE: {
    // Default concurrency for queue processing
    DEFAULT_CONCURRENCY: 3,

    // Default max retries for queue items
    DEFAULT_MAX_RETRIES: 3,

    // Default retry delay in milliseconds
    DEFAULT_RETRY_DELAY_MS: 1000,
  },

  // RPC client settings
  RPC_CLIENT: {
    // Default timeout for RPC requests in milliseconds
    DEFAULT_TIMEOUT_MS: 10000, // 10 seconds

    // Maximum number of retry attempts
    MAX_RETRY_ATTEMPTS: 3,

    // Retry delay in milliseconds
    RETRY_DELAY_MS: 1000, // 1 second
  },
};

// HTTP and API settings
export const HTTP = {
  // Default port
  DEFAULT_PORT: 3000,

  // Default host
  DEFAULT_HOST: '0.0.0.0',

  // API endpoints
  ENDPOINTS: {
    HEALTH: '/health',
    METRICS: '/metrics',
    API: '/api',
  },

  // Rate limiting
  RATE_LIMIT: {
    WINDOW_MS: 15 * 60 * 1000, // 15 minutes
    MAX_REQUESTS: 100, // 100 requests per window
  },

  // Timeouts
  TIMEOUTS: {
    DEFAULT_TIMEOUT_MS: 30000, // 30 seconds
  },
};

// Features and modules
export const FEATURES = {
  // Feature flags
  ENABLED: {
    BLOCK_MONITORING: true,
    RPC_MONITORING: true,
    TRANSACTION_MONITORING: true,
    ALERTS: true,
    METRICS: true,
    API: true,
  },

  // Dashboard and UI
  DASHBOARD: {
    REFRESH_INTERVAL_MS: 10000, // 10 seconds
    MAX_BLOCKS_DISPLAY: 50,
    MAX_TRANSACTIONS_DISPLAY: 100,
  },
};
