// Default monitoring configuration values
export const DEFAULT_SCAN_INTERVAL = 15; // seconds
export const DEFAULT_BLOCKS_TO_SCAN = 10;
export const DEFAULT_BLOCK_TIME_THRESHOLD = 2.0; // seconds
export const DEFAULT_RECENT_BLOCKS_SAMPLE_SIZE = 100;
export const DEFAULT_HIGH_BLOCK_TIME_THRESHOLD = 2.5; // seconds for average alert

// Monitoring feature flags defaults
export const DEFAULT_ENABLE_RPC_MONITORING = true;
export const DEFAULT_ENABLE_PORT_MONITORING = true;
export const DEFAULT_ENABLE_BLOCK_MONITORING = true;
export const DEFAULT_ENABLE_TRANSACTION_MONITORING = true;

// Alert configuration defaults
export const DEFAULT_ENABLE_DASHBOARD_ALERTS = true;
export const DEFAULT_ENABLE_CHAT_NOTIFICATIONS = false;

// InfluxDB defaults
export const DEFAULT_INFLUXDB_URL = 'http://localhost:8086';
export const DEFAULT_INFLUXDB_ORG = 'xdc';
export const DEFAULT_INFLUXDB_BUCKET = 'xdc_metrics';

// Default log level
export const DEFAULT_LOG_LEVEL = 'info';
