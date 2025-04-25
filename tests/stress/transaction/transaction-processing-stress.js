/**
 * Transaction Processing Stress Test
 * 
 * This script tests the transaction monitoring component under high load conditions.
 * It simulates high transaction volume, failed transactions, and contract deployments
 * to test the system's ability to handle extreme transaction processing scenarios.
 * 
 * This test supports multiple chains (configured in config.js).
 * Enable/disable chains by toggling their 'enabled' flag in the CHAINS array.
 */

import { check, sleep } from 'k6';
import http from 'k6/http';
import { Counter, Rate, Trend } from 'k6/metrics';
import { BASE_URL, ENDPOINTS, STAGES, THRESHOLDS, utils } from './config.js';

// Custom metrics
const txSuccessRate = new Rate('transaction_success');
const contractSuccessRate = new Rate('contract_deployment_success');
const txProcessingTime = new Trend('transaction_processing_time');
const contractProcessingTime = new Trend('contract_processing_time');
const txCount = new Counter('transactions_submitted');

// Test configuration
export const options = {
  stages: STAGES.STANDARD,
  thresholds: {
    ...THRESHOLDS.HEAVY,
    'transaction_success': ['rate>0.85'],  // At least 85% of transactions should succeed
    'contract_deployment_success': ['rate>0.8'],  // At least 80% of contract deployments should succeed
    'transaction_processing_time': ['p(95)<15000'],  // 95% of txs processed within 15s
  },
  // We'll set tags dynamically in the setup function
  tags: {}
};

// Check if we have any enabled chains
const enabledChains = utils.getEnabledChains();
if (enabledChains.length === 0) {
  throw new Error('No chains enabled for testing in config.js. Please enable at least one chain.');
}

// Transaction types to test
const TX_TYPES = [
  { name: 'simple_transfer', weight: 0.7 },  // 70% simple transfers
  { name: 'contract_deployment', weight: 0.3 },  // 30% contract deployments
];

// Select transaction type based on weighted probability
function selectTxType() {
  const rand = Math.random();
  let cumulativeWeight = 0;
  
  for (const type of TX_TYPES) {
    cumulativeWeight += type.weight;
    if (rand <= cumulativeWeight) {
      return type.name;
    }
  }
  
  return TX_TYPES[0].name; // Default to first type
}

// Main test function
export default function() {
  // Select a random enabled chain from configuration
  const chain = utils.getRandomEnabledChain();
  const chainId = chain.chainId;
  
  // Select transaction type
  const txType = selectTxType();
  
  // Prepare request payload
  const payload = {
    chainId: chainId,
    // Add optional failure simulation (10% of requests)
    simulateFailure: Math.random() < 0.1,
    // Add network identifier for logging
    network: chain.name
  };
  
  // Record start time
  const startTime = new Date().getTime();
  
  // Make the appropriate request based on transaction type
  let response;
  if (txType === 'simple_transfer') {
    // Test simple value transfer
    response = http.post(
      `${BASE_URL}${ENDPOINTS.TRIGGER_TEST_TX}`, 
      JSON.stringify(payload),
      { headers: { 'Content-Type': 'application/json' } }
    );
    
    // Record metrics
    txCount.add(1, { chainId: chainId, network: chain.name, type: txType });
    const success = check(response, {
      'status is 200': (r) => r.status === 200,
      'transaction submitted': (r) => JSON.parse(r.body).success === true,
    });
    txSuccessRate.add(success ? 1 : 0, { chainId: chainId, network: chain.name, type: txType });
    txProcessingTime.add(new Date().getTime() - startTime, { chainId: chainId, network: chain.name, type: txType });
    
  } else if (txType === 'contract_deployment') {
    // Test contract deployment
    response = http.post(
      `${BASE_URL}${ENDPOINTS.TRIGGER_TEST_CONTRACT}`, 
      JSON.stringify(payload),
      { headers: { 'Content-Type': 'application/json' } }
    );
    
    // Record metrics
    txCount.add(1, { chainId: chainId, network: chain.name, type: txType });
    const success = check(response, {
      'status is 200': (r) => r.status === 200,
      'contract deployed': (r) => JSON.parse(r.body).success === true,
    });
    contractSuccessRate.add(success ? 1 : 0, { chainId: chainId, network: chain.name, type: txType });
    contractProcessingTime.add(new Date().getTime() - startTime, { chainId: chainId, network: chain.name, type: txType });
  }
  
  // Log failures for debugging
  if (response.status !== 200) {
    console.log(`Failed ${txType} on chain ${chainId}: ${response.status} ${response.body}`);
  }
  
  // Add variable delay between requests to simulate realistic patterns
  sleep(utils.randomSleep(1, 3));
}

/**
 * To run this test:
 * 1. Install k6: https://k6.io/docs/getting-started/installation/
 * 2. Start your XDC Monitor application
 * 3. Run: k6 run transaction-processing-stress.js
 * 
 * This test will:
 * - Generate a mix of simple transfers and contract deployments
 * - Test all enabled chains as configured in config.js
 * - Occasionally simulate transaction failures
 * - Measure success rates and processing times
 * 
 * For more advanced testing:
 * - Adjust the TX_TYPES weights to test different transaction mixes
 * - Modify the simulateFailure rate to test error handling
 * - Increase the number of virtual users to simulate higher transaction volume
 * - Toggle the enabled flag in CHAINS array in config.js to test different networks
 */
