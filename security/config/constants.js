/**
 * Security scanning system constants
 * 
 * This file contains shared configuration for all security scanners
 */

// XDC Network constants
export const XDC_CONFIG = {
  // Standard ports used by XDC nodes
  RPC_PORTS: [8545, 8546, 8547],
  WS_PORTS: [8548, 8549],
  P2P_PORTS: [30303, 30301],
  
  // Common RPC APIs that should be restricted in production
  RESTRICTED_APIS: ['admin', 'debug', 'personal', 'miner'],
  
  // Default XDC RPC endpoints
  MAINNET_ENDPOINTS: [], // Disabled
  TESTNET_ENDPOINTS: [
    'https://rpc.apothem.network',
    'https://erpc.apothem.network',
    'https://apothem.xdcrpc.com',
    'https://apothem-rpc.xinfin.network',
  ],
  
  // Security threshold settings
  THRESHOLDS: {
    MAX_RESPONSE_TIME_MS: 5000,
    MIN_TLS_VERSION: 1.2,
    MAX_HEADERS_EXPOSED: 3,
  }
};

// Security scan settings
export const SCAN_CONFIG = {
  SCAN_INTERVALS: {
    QUICK: '10m',        // Quick vulnerability scan
    STANDARD: '1h',      // Standard security audit
    COMPREHENSIVE: '6h'  // Deep security inspection
  },
  
  SEVERITY_LEVELS: {
    CRITICAL: 5,
    HIGH: 4,
    MEDIUM: 3,
    LOW: 2,
    INFO: 1
  },
  
  DEFAULT_REPORT_PATH: '../reports'
};

// Integration with XDC Monitor
export const MONITOR_CONFIG = {
  ALERT_ENDPOINT: '/api/alerts/security',
  METRICS_ENDPOINT: '/api/metrics/security',
  REPORT_ENDPOINT: '/api/reports/security'
};
