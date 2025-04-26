/**
 * RPC Endpoint Stress Test
 *
 * This script tests the RPC monitoring component under high load conditions.
 * It simulates multiple RPC endpoints and applies increasing load to test
 * the system's ability to handle endpoint failures, high endpoint counts,
 * and concurrent monitoring operations.
 *
 * This test supports multiple chains (configured in config.js).
 * Enable/disable chains by toggling their 'enabled' flag in the CHAINS array.
 */

import { check, sleep } from 'k6';
import http from 'k6/http';
import { Counter, Rate, Trend } from 'k6/metrics';
import { BASE_URL, ENDPOINTS, utils } from '../config.js';

// Custom metrics
const failRate = new Rate('failed_requests');
const endpointChecks = new Counter('endpoint_checks');
const responseTime = new Trend('response_time');

// Test configuration
export const options = {
  stages: [
    { duration: '1m', target: 10 }, // Ramp up to 10 VUs
    { duration: '2m', target: 20 }, // Ramp up to 20 VUs
    { duration: '5m', target: 50 }, // Stress phase with 50 VUs
    { duration: '2m', target: 0 }, // Ramp down to 0 VUs
  ],
  thresholds: {
    failed_requests: ['rate<0.1'], // Error rate must be less than 10%
    http_req_duration: ['p(95)<5000'], // 95% of requests must complete within 5s
    response_time: ['p(99)<10000'], // 99% of response times under 10s
  },
};

// Check if we have any enabled chains
const enabledChains = utils.getEnabledChains();
if (enabledChains.length === 0) {
  throw new Error('No chains enabled for testing in config.js. Please enable at least one chain.');
}

// Define base endpoints - we'll add chainId dynamically in the test
const baseEndpoints = [
  ENDPOINTS.RPC_STATUS,
  ENDPOINTS.WEBSOCKET_STATUS,
  ENDPOINTS.BLOCK_STATUS,
  ENDPOINTS.CONSENSUS_STATUS,
  ENDPOINTS.TRANSACTION_STATUS,
];

// Main test function
export default function () {
  // Select a random enabled chain
  const chain = utils.getRandomEnabledChain();

  // Select a random endpoint type to test
  const baseEndpoint = baseEndpoints[Math.floor(Math.random() * baseEndpoints.length)];
  const endpoint = `${baseEndpoint}?chainId=${chain.chainId}`;

  // Make the request
  const startTime = new Date().getTime();
  const response = http.get(`${BASE_URL}${endpoint}`, {
    tags: {
      endpoint: baseEndpoint,
      network: chain.name,
      chainId: chain.chainId,
    },
  });
  const endTime = new Date().getTime();

  // Record metrics
  responseTime.add(endTime - startTime, { network: chain.name, chainId: chain.chainId, endpoint: baseEndpoint });
  endpointChecks.add(1, { network: chain.name, chainId: chain.chainId, endpoint: baseEndpoint });

  // Check response
  const success = check(
    response,
    {
      'status is 200': r => r.status === 200,
      'response has data': r => r.body.length > 0,
    },
    { network: chain.name, chainId: chain.chainId, endpoint: baseEndpoint },
  );

  if (!success) {
    failRate.add(1, { network: chain.name, chainId: chain.chainId, endpoint: baseEndpoint });
    console.log(`Failed request to ${endpoint} (${chain.name}): ${response.status} ${response.body}`);
  } else {
    failRate.add(0, { network: chain.name, chainId: chain.chainId, endpoint: baseEndpoint });
  }

  // Simulate endpoint processing time
  sleep(Math.random() * 1 + 0.5); // Sleep between 0.5-1.5 seconds
}

/**
 * To run this test:
 * 1. Install k6: https://k6.io/docs/getting-started/installation/
 * 2. Start your XDC Monitor application
 * 3. Run: k6 run rpc-endpoint-stress.js
 *
 * This test will:
 * - Gradually increase load on RPC monitoring endpoints for all enabled chains
 * - Measure response times and error rates
 * - Test the system's ability to handle concurrent monitoring requests
 * - Support both Testnet and Mainnet based on configuration
 *
 * For more advanced testing:
 * - Adjust the stages and thresholds based on your performance requirements
 * - Add authentication if your API requires it
 * - Toggle the enabled flag in CHAINS array in config.js to test different networks
 */
