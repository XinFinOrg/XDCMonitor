/**
 * Consensus Monitoring Stress Test
 *
 * This script tests the consensus monitoring component under high load conditions.
 * It simulates high validator activity and applies increasing load to test
 * the system's ability to monitor consensus conditions.
 *
 * This test supports multiple chains (configured in config.js).
 * Enable/disable chains by toggling their 'enabled' flag in the CHAINS array.
 */

import { check, sleep } from 'k6';
import http from 'k6/http';
import { Counter, Rate, Trend } from 'k6/metrics';
import { BASE_URL, ENDPOINTS, STAGES, THRESHOLDS, utils } from '../config.js';

// Custom metrics
const consensusResponseTime = new Trend('consensus_response_time');
const minerPerformanceChecks = new Counter('miner_performance_checks');
const epochChecks = new Counter('epoch_checks');
const consensusSuccessRate = new Rate('consensus_check_success');
const consensusErrors = new Counter('consensus_errors');

// Test configuration
export const options = {
  stages: STAGES.STANDARD,
  thresholds: {
    ...THRESHOLDS.HEAVY,
    consensus_check_success: ['rate>0.9'], // At least 90% of consensus checks should succeed
    consensus_response_time: ['p(95)<12000'], // 95% of responses within 12s
  },
};

// Check if we have any enabled chains
const enabledChains = utils.getEnabledChains();
if (enabledChains.length === 0) {
  throw new Error('No chains enabled for testing in config.js. Please enable at least one chain.');
}

// Consensus query types
const CONSENSUS_QUERY_TYPES = [
  { name: 'miners_performance', endpoint: ENDPOINTS.CONSENSUS_STATUS, path: 'masternode-performance', weight: 0.4 },
  { name: 'consensus_status', endpoint: ENDPOINTS.CONSENSUS_STATUS, path: '', weight: 0.3 },
  { name: 'consensus_violations', endpoint: ENDPOINTS.CONSENSUS_STATUS, path: 'consensus-violations', weight: 0.2 },
  { name: 'penalty_list', endpoint: ENDPOINTS.CONSENSUS_STATUS, path: 'penalty-list', weight: 0.1 },
];

// Select query type based on weighted probability
function selectConsensusQueryType() {
  const rand = Math.random();
  let cumulativeWeight = 0;

  for (const type of CONSENSUS_QUERY_TYPES) {
    cumulativeWeight += type.weight;
    if (rand <= cumulativeWeight) {
      return type;
    }
  }

  return CONSENSUS_QUERY_TYPES[0]; // Default to first type
}

// Main test function
export default function () {
  // Select a random enabled chain
  const chain = utils.getRandomEnabledChain();
  const chainId = chain.chainId;

  // Select consensus query type
  const queryType = selectConsensusQueryType();

  // Construct the endpoint URL
  let url;
  if (queryType.path) {
    url = `${BASE_URL}${queryType.endpoint}/${queryType.path}/${chainId}`;
  } else {
    url = `${BASE_URL}${queryType.endpoint}?chainId=${chainId}`;
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

  // Record response time
  const responseTime = new Date().getTime() - startTime;
  consensusResponseTime.add(responseTime, { chainId: chainId, network: chain.name, type: queryType.name });

  // Increment appropriate counter
  if (queryType.name === 'miners_performance') {
    minerPerformanceChecks.add(1, { chainId: chainId, network: chain.name });
  } else if (queryType.name === 'consensus_status') {
    epochChecks.add(1, { chainId: chainId, network: chain.name });
  }

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
  consensusSuccessRate.add(success ? 1 : 0, { chainId: chainId, network: chain.name, type: queryType.name });

  if (!success) {
    consensusErrors.add(1, { chainId: chainId, network: chain.name, type: queryType.name });
    console.log(
      `Failed consensus query on chain ${chain.name} (${chainId}) using ${queryType.name}: ${response.status} ${response.body.substring(0, 100)}...`,
    );
  }

  // Simulate processing time and random sleep between requests
  sleep(utils.randomSleep(1, 3));
}

/**
 * To run this test:
 * 1. Install k6
 * 2. Start your XDC Monitor application
 * 3. Run: k6 run consensus-monitoring-stress.js
 *
 * This test will:
 * - Test consensus monitoring for all enabled chains
 * - Simulate different types of consensus queries with weighted distribution
 * - Measure response times and success rates with chain-specific metrics
 * - Validate the system's ability to handle concurrent consensus monitoring
 *
 * For more advanced testing:
 * - Adjust query types and weights to focus on specific consensus aspects
 * - Enable additional chains by toggling flags in config.js
 * - Modify thresholds based on expected performance characteristics
 */
