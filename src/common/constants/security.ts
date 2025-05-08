/**
 * Security module constants and configuration
 */

// Security metrics measurement names
export const SECURITY_METRICS = {
  // Network scanner metrics
  NETWORK_SCAN: 'security_network_scan',
  VULNERABILITY: 'security_vulnerability',

  // Config auditor metrics
  CONFIG_AUDIT: 'security_config_audit',
  CONFIG_FINDING: 'security_config_finding',

  // Overall security metrics
  SECURITY_SCAN: 'security_scan',
  SECURITY_SUMMARY: 'security_summary',
};

// Security severity levels (matching standard severity classifications)
export enum SeverityLevel {
  INFO = 0,
  LOW = 1,
  MEDIUM = 2,
  HIGH = 3,
  CRITICAL = 4,
}

// Network vulnerability types
export enum VulnerabilityType {
  EXPOSED_RPC = 'exposed_rpc',
  ADMIN_API_EXPOSED = 'admin_api_exposed',
  PERFORMANCE = 'performance',
  INFORMATION_DISCLOSURE = 'information_disclosure',
  MISSING_AUTH = 'missing_auth',
}

// Configuration vulnerability types
export enum ConfigVulnerabilityType {
  RPC_SECURITY = 'rpc_security',
  AUTH_SECURITY = 'auth_security',
  NETWORK_SECURITY = 'network_security',
  RESOURCE_SECURITY = 'resource_security',
  GENERAL_SECURITY = 'general_security',
}

// Security scanner configuration
export const SECURITY_SCANNER_CONFIG = {
  // Default report path
  DEFAULT_REPORT_PATH: 'reports/security',

  // Default timeout (in ms)
  DEFAULT_TIMEOUT: 5000,

  // Default concurrency
  DEFAULT_CONCURRENCY: 5,
};

// Standard API methods to test access during security scanning
export const SECURITY_TEST_METHODS = {
  admin: 'listAccounts',
  debug: 'metrics',
  personal: 'listAccounts',
  miner: 'hashrate',
  txpool: 'content',
  clique: 'getSigners',
  signer: 'list',
};

// XDC Network endpoints for security scanning
export const XDC_ENDPOINTS = {
  MAINNET: [], // Empty for safety, can be populated when needed
  TESTNET: ['https://rpc.apothem.network', 'https://apothem.xdcrpc.com', 'https://erpc.apothem.network'],
};

// XDC Network configuration for security scanning
export const XDC_SECURITY_CONFIG = {
  // Standard RPC ports for scanning
  RPC_PORTS: [8545, 8546, 80, 443, 8080],

  // Restricted APIs that should not be publicly exposed
  RESTRICTED_APIS: ['admin', 'debug', 'personal', 'miner', 'txpool', 'clique', 'signer'],

  // Thresholds for security issues
  THRESHOLDS: {
    MAX_RESPONSE_TIME_MS: 5000, // 5 seconds is too slow
    MIN_RESPONSE_TIME_MS: 10, // 10ms is suspiciously fast (likely not doing proper validation)
  },
};
