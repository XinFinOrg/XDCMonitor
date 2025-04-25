/**
 * Stress Test Configuration
 * 
 * This file contains shared configuration for all stress tests.
 * It provides consistent settings and utilities for stress test scripts.
 */

// Base URL for the XDC Monitor API
export const BASE_URL = 'http://localhost:3000';

// Chain/network definitions
export const CHAINS = [
  {
    enabled: true, // Toggle to enable/disable this chain for stress tests
    chainId: 51,
    name: 'Testnet',
    endpoints: [
      'https://rpc.apothem.network',
      'https://erpc.apothem.network',
      'https://apothem.xdcrpc.com',
      'https://apothem-rpc.xinfin.network',
    ],
  },
  {
    enabled: false, // Set to true to enable Mainnet stress testing
    chainId: 50,
    name: 'Mainnet',
    endpoints: [
      'https://rpc.xinfin.network',
      'https://erpc.xinfin.network',
      'https://xdcrpc.com',
      'https://xinfin.network',
    ],
  },
  // Add more chains as needed
];

// Test environment settings
export const ENV = {
  // Default test durations (can be overridden in individual tests)
  RAMP_UP_DURATION: '1m',
  STRESS_DURATION: '5m',
  RAMP_DOWN_DURATION: '1m',
  
  // Default VU (virtual user) counts
  MIN_VU: 1,
  NORMAL_VU: 20,
  HIGH_VU: 50,
  EXTREME_VU: 100,
  
  // Thresholds
  MAX_ERROR_RATE: 0.1,        // 10% error rate
  P95_RESPONSE_TIME: 5000,    // 95% of requests under 5s
  P99_RESPONSE_TIME: 10000,   // 99% of requests under 10s
  
  // Test data
  SAMPLE_TX_HASH: '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
  SAMPLE_BLOCK_NUMBER: '12345678',
  SAMPLE_ADDRESS: '0xabcdef1234567890abcdef1234567890abcdef12',
  
  // Legacy network focus values - kept for backward compatibility
  // Use the CHAINS array and utils.getEnabledChains() for new tests
};

// Common test stages presets
export const STAGES = {
  // Quick test for development (2 minutes total)
  QUICK: [
    { duration: '30s', target: 5 },
    { duration: '1m', target: 10 },
    { duration: '30s', target: 0 },
  ],
  
  // Standard test (10 minutes total)
  STANDARD: [
    { duration: '1m', target: 10 },
    { duration: '2m', target: 20 },
    { duration: '5m', target: 50 },
    { duration: '2m', target: 0 },
  ],
  
  // Extended test for thorough validation (30 minutes total)
  EXTENDED: [
    { duration: '3m', target: 10 },
    { duration: '5m', target: 30 },
    { duration: '10m', target: 50 },
    { duration: '10m', target: 100 },
    { duration: '2m', target: 0 },
  ],
  
  // Endurance test (2+ hours)
  ENDURANCE: [
    { duration: '5m', target: 10 },
    { duration: '10m', target: 30 },
    { duration: '1h', target: 50 },
    { duration: '1h', target: 75 },
    { duration: '5m', target: 0 },
  ],
};

// Common threshold presets
export const THRESHOLDS = {
  // Basic thresholds for API endpoints
  API: {
    'failed_requests': ['rate<0.1'],
    'http_req_duration': ['p(95)<5000'],
  },
  
  // Stricter thresholds for critical components
  CRITICAL: {
    'failed_requests': ['rate<0.05'],
    'http_req_duration': ['p(95)<3000', 'p(99)<5000'],
  },
  
  // Relaxed thresholds for heavy operations
  HEAVY: {
    'failed_requests': ['rate<0.15'],
    'http_req_duration': ['p(95)<8000'],
  },
};

// API endpoints
export const ENDPOINTS = {
  // Monitoring endpoints
  RPC_STATUS: '/api/monitoring/rpc-status',
  WEBSOCKET_STATUS: '/api/monitoring/websocket-status',
  BLOCK_STATUS: '/api/monitoring/block-status',
  CONSENSUS_STATUS: '/api/monitoring/consensus-status',
  TRANSACTION_STATUS: '/api/monitoring/transaction-status',
  
  // Testing endpoints
  TRIGGER_TEST_TX: '/api/testing/trigger-test-transaction',
  TRIGGER_TEST_CONTRACT: '/api/testing/trigger-test-contract',
  TRIGGER_ALERT: '/api/testing/trigger-alert',
};

// Utility functions
export const utils = {
  // Generate a random delay between min and max seconds
  randomSleep: (min, max) => {
    const delay = (Math.random() * (max - min)) + min;
    return delay;
  },
  
  // Get enabled chains only
  getEnabledChains: () => CHAINS.filter(chain => chain.enabled),
  
  // Get a chain by chainId
  getChainById: (chainId) => CHAINS.find(chain => chain.chainId === chainId),
  
  // Pick a random enabled chain (useful for multi-chain load)
  getRandomEnabledChain: () => {
    const enabled = utils.getEnabledChains();
    if (enabled.length === 0) {
      throw new Error('No chains are enabled for testing. Enable at least one chain in the CHAINS array.');
    }
    return enabled[Math.floor(Math.random() * enabled.length)];
  },
  
  // Pick a random endpoint for a given chain
  getRandomRpcUrl: (chain) => {
    if (!chain || !chain.endpoints || chain.endpoints.length === 0) {
      throw new Error(`No endpoints available for chain ${chain?.name || 'unknown'}`);
    }
    return chain.endpoints[Math.floor(Math.random() * chain.endpoints.length)];
  },
  
  // Legacy functions - kept for backward compatibility with existing tests
  // New tests should use getRandomEnabledChain() and chain.chainId instead
  getTargetChainId: () => {
    // Get first enabled chain's ID or fall back to Testnet (51)
    const enabledChains = utils.getEnabledChains();
    return enabledChains.length > 0 ? enabledChains[0].chainId : 51;
  },
};

// Export default configuration
export default {
  BASE_URL,
  ENV,
  STAGES,
  THRESHOLDS,
  ENDPOINTS,
  utils,
};
