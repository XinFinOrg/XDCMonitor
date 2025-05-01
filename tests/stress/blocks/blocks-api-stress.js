/**
 * Blocks Processing Stress Test
 *
 * This script tests the blocks monitoring component under high load conditions.
 * It simulates high block production rates and applies increasing load to test
 * the system's ability to handle block processing scenarios.
 *
 * This test supports multiple chains (configured in config.js).
 * Enable/disable chains by toggling their 'enabled' flag in the CHAINS array.
 */

import { check, sleep } from 'k6';
import http from 'k6/http';
import { Counter, Rate, Trend } from 'k6/metrics';
import { BASE_URL, ENDPOINTS, STAGES, THRESHOLDS, utils } from '../config.js';

// Custom metrics
const blockProcessingTime = new Trend('block_processing_time');
const blockSyncRate = new Rate('block_sync_success');
const blockChecks = new Counter('block_checks');
const blockErrors = new Counter('block_errors');

// Test configuration
export const options = {
  stages: STAGES.STANDARD,
  thresholds: {
    ...THRESHOLDS.HEAVY,
    block_sync_success: ['rate>0.9'], // At least 90% of block syncs should succeed
    block_processing_time: ['p(95)<10000'], // 95% of blocks processed within 10s
  },
};

// Check if we have any enabled chains
const enabledChains = utils.getEnabledChains();
if (enabledChains.length === 0) {
  throw new Error('No chains enabled for testing in config.js. Please enable at least one chain.');
}

// Block query types
const BLOCK_QUERY_TYPES = [
  { name: 'latest_block', endpoint: '/api/block/latest', weight: 0.5 },
  { name: 'block_by_number', endpoint: '/api/block/by-number', weight: 0.3 },
  { name: 'block_with_transactions', endpoint: '/api/block/with-transactions', weight: 0.2 },
];

// Select query type based on weighted probability
function selectBlockQueryType() {
  const rand = Math.random();
  let cumulativeWeight = 0;

  for (const type of BLOCK_QUERY_TYPES) {
    cumulativeWeight += type.weight;
    if (rand <= cumulativeWeight) {
      return type;
    }
  }

  return BLOCK_QUERY_TYPES[0]; // Default to first type
}

// Generate a random block number
function getRandomBlockNumber(chain) {
  // For a real implementation, you might want to fetch the latest block number
  // and select a random block within a reasonable range
  // For now we'll use a placeholder range
  const maxBlock = chain.chainId === 50 ? 50000000 : 30000000; // Placeholder values
  return Math.floor(Math.random() * maxBlock);
}

// Main test function
export default function () {
  // Select a random enabled chain
  const chain = utils.getRandomEnabledChain();
  const chainId = chain.chainId;

  // Select block query type
  const queryType = selectBlockQueryType();

  // Prepare endpoint and parameters
  let endpoint = `${ENDPOINTS.BLOCK_STATUS}?chainId=${chainId}`;
  let url = `${BASE_URL}${endpoint}`;
  let params = {};

  if (queryType.name === 'block_by_number' || queryType.name === 'block_with_transactions') {
    const blockNumber = getRandomBlockNumber(chain);
    url = `${BASE_URL}${queryType.endpoint}/${blockNumber}?chainId=${chainId}`;
  }

  // Record start time
  const startTime = new Date().getTime();

  // Make the request
  const response = http.get(url, {
    tags: {
      chain: chain.name,
      chainId: chainId,
      queryType: queryType.name,
    },
  });

  // Record processing time
  const processingTime = new Date().getTime() - startTime;
  blockProcessingTime.add(processingTime, { chainId: chainId, network: chain.name, type: queryType.name });
  blockChecks.add(1, { chainId: chainId, network: chain.name, type: queryType.name });

  // Check response
  const success = check(
    response,
    {
      'status is 200': r => r.status === 200,
      'response has data': r => r.body.length > 0,
      'response is valid JSON': r => {
        try {
          JSON.parse(r.body);
          return true;
        } catch (e) {
          return false;
        }
      },
    },
    { chainId: chainId, network: chain.name, type: queryType.name },
  );

  // Record success/failure
  blockSyncRate.add(success ? 1 : 0, { chainId: chainId, network: chain.name, type: queryType.name });

  if (!success) {
    blockErrors.add(1, { chainId: chainId, network: chain.name, type: queryType.name });
    console.log(
      `Failed to query block on chain ${chain.name} (${chainId}) using ${queryType.name}: ${response.status} ${response.body.substring(0, 100)}...`,
    );
  }

  // Simulate processing time and random sleep between requests
  sleep(utils.randomSleep(0.5, 2));
}

/**
 * To run this test:
 * 1. Install k6
 * 2. Start your XDC Monitor application
 * 3. Run: k6 run blocks-processing-stress.js
 *
 * This test will:
 * - Simulate block queries against all enabled chains
 * - Test different types of block queries with weighted distribution
 * - Measure block processing times and success rates
 * - Report errors with chain-specific tagging
 *
 * For more advanced testing:
 * - Adjust query types and weights for different test scenarios
 * - Enable/disable chains in the CHAINS array in config.js
 * - Run longer test durations for stability testing
 */
