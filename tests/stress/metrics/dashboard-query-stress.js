/**
 * Dashboard Query Stress Test (True Direct Module Testing)
 * 
 * This script tests the performance of metrics queries from InfluxDB that power
 * Grafana dashboards by directly importing and using the actual module code.
 * It simulates multiple dashboard users and panels refreshing with different query patterns and time ranges.
 *
 * Focus areas:
 * - Query response time under concurrent load
 * - Complex aggregation query performance
 * - Long-term data retrieval efficiency
 * - Dashboard refresh patterns
 * 
 * This test supports multiple chains (configured in config.js).
 * Enable/disable chains by toggling their 'enabled' flag in the CHAINS array.
 * 
 * MOCK_MODE can be enabled by setting the environment variable: MOCK_MODE=true
 */

import { randomIntBetween } from 'https://jslib.k6.io/k6-utils/1.2.0/index.js';
import { check, group, sleep } from 'k6';
import { Counter, Rate, Trend } from 'k6/metrics';

// Import config and utilities
import { STAGES, utils } from '../config.js';
import { mockRequest } from '../utils/mock-server.js';

// DIRECT MODULE IMPORTS - Import the actual modules from the codebase
import { MetricsService } from '../../../src/metrics/metrics.service';
import { DashboardService } from '../../../src/dashboard/dashboard.service';
import { ConfigService } from '../../../src/config/config.service';
import { LoggerService } from '../../../src/logger/logger.service';

// Custom metrics
const queryResponseTime = new Trend('dashboard_query_response_time');
const querySize = new Trend('dashboard_query_size_points');
const queriesPerSecond = new Counter('dashboard_queries_per_second');
const complexQueryLatency = new Trend('dashboard_complex_query_latency');
const simpleQueryLatency = new Trend('dashboard_simple_query_latency');
const querySuccessRate = new Rate('dashboard_query_success_rate');
const blockQuerySuccessRate = new Rate('dashboard_block_query_success_rate');
const txQuerySuccessRate = new Rate('dashboard_tx_query_success_rate');
const statsQuerySuccessRate = new Rate('dashboard_stats_query_success_rate');
const queriesCount = new Counter('dashboard_queries_count');
const dataPointsRetrieved = new Counter('dashboard_data_points_retrieved');

// Configure the load test
export const options = {
  stages: STAGES.STANDARD,
  thresholds: {
    'dashboard_query_response_time': ['p(95)<3000'],     // 95% of queries under 3s
    'dashboard_complex_query_latency': ['p(95)<5000'],   // 95% of complex queries under 5s
    'dashboard_simple_query_latency': ['p(95)<1500'],    // 95% of simple queries under 1.5s
    'dashboard_query_success_rate': ['rate>0.98'],        // 98% success rate for all queries
    'dashboard_block_query_success_rate': ['rate>0.98'],  // 98% success rate for block queries
    'dashboard_tx_query_success_rate': ['rate>0.98'],     // 98% success rate for transaction queries
    'dashboard_stats_query_success_rate': ['rate>0.98'],  // 98% success rate for stats queries
  },
};

// Define common dashboard query types
const QUERY_TYPES = {
  LATEST_BLOCKS: 'latest_blocks',
  BLOCK_TIME_SERIES: 'block_time_series',
  TRANSACTION_VOLUME: 'transaction_volume',
  RPC_HEALTH: 'rpc_health',
};

// Define time ranges for queries
const TIME_RANGES = {
  LAST_5M: '5m',
  LAST_15M: '15m',
  LAST_1H: '1h',
  LAST_6H: '6h',
  LAST_24H: '24h',
  LAST_7D: '7d',
  LAST_30D: '30d'
};

/**
 * Helper to generate query parameters for different dashboard panel types
 * @param {string} type - Type of query to generate parameters for
 * @param {number} timeRange - Time range in seconds
 * @param {object} chain - Chain configuration
 * @returns {object} Query parameters
 */
function getQueryParams(type, timeRange, chain) {
  const now = new Date().getTime();
  const params = {
    chainId: chain.chainId,
    from: now - (timeRange * 1000),
    to: now,
    interval: Math.floor(timeRange / 60) + 'm',
  };
  
  switch (type) {
    case QUERY_TYPES.LATEST_BLOCKS:
      params.limit = randomIntBetween(10, 100);
      params.fields = ['number', 'timestamp', 'hash', 'gasUsed', 'size'];
      params.measurement = 'xdc_blocks';
      break;
      
    case QUERY_TYPES.BLOCK_TIME_SERIES:
      params.groupBy = 'time(' + params.interval + ')';
      params.aggregation = ['mean', 'max', 'count'][Math.floor(Math.random() * 3)];
      params.fields = ['time', 'number', 'gasUsed', 'size', 'txCount'];
      params.measurement = 'xdc_blocks';
      break;
      
    case QUERY_TYPES.TRANSACTION_VOLUME:
      params.groupBy = 'time(' + params.interval + ')';
      params.aggregation = 'sum';
      params.fields = ['count', 'value'];
      params.measurement = 'xdc_transactions';
      break;
      
    case QUERY_TYPES.NETWORK_STATS:
      params.groupBy = 'time(' + params.interval + ')';
      params.fields = ['blockTime', 'hashRate', 'difficulty', 'gasPrice'];
      params.measurement = 'xdc_network_stats';
      break;
      
    case QUERY_TYPES.VALIDATOR_PERFORMANCE:
      params.limit = randomIntBetween(10, 50);
      params.orderBy = 'performance';
      params.direction = 'desc';
      params.fields = ['address', 'blocksProduced', 'rewards', 'uptime', 'performance'];
      params.measurement = 'xdc_validators';
      break;
      
    case QUERY_TYPES.COMPLEX_AGGREGATION:
      params.groupBy = ['time(' + params.interval + ')', 'status'];
      params.having = `sum("count") > ${randomIntBetween(5, 50)}`;
      params.calculations = ['max("gasUsed") as maxGas', 'sum("value") as totalValue', 'count(*)'];
      params.measurement = 'xdc_' + ['blocks', 'transactions'][Math.floor(Math.random() * 2)];
      break;
  }
  
  return params;
}

/**
 * Helper to perform true direct module testing of dashboard metrics queries
 * @param {object} chain - Chain configuration
 * @param {string} queryType - Type of query to perform
 * @param {number} timeRange - Time range in seconds
 * @returns {object} Query result with response and metadata
 */
function testDashboardQuery(chain, queryType, timeRange) {
  const startTime = new Date().getTime();
  let response = { success: false };
  
  // Create necessary services for the MetricsService and DashboardService
  const configService = new ConfigService();
  const loggerService = new LoggerService(configService);
  
  // Initialize the actual service modules
  const metricsService = new MetricsService(configService, loggerService);
  const dashboardService = new DashboardService(configService, loggerService, metricsService);
  
  // Generate query parameters based on the query type
  const queryParams = getQueryParams(queryType, timeRange, chain);
  
  // If in mock mode, don't try to use the actual module
  const isMockMode = __ENV.MOCK_MODE === 'true' || __ENV.MOCK_MODE === true;
  
  try {
    if (!isMockMode) {
      // Direct call to the actual service modules
      if (queryType === QUERY_TYPES.COMPLEX_AGGREGATION) {
        response = dashboardService.executeComplexQuery(queryParams);
      } else {
        response = metricsService.query(queryParams);
      }
    } else {
      // Mock mode simulation
      sleep(queryType === QUERY_TYPES.COMPLEX_AGGREGATION ? 0.5 : 0.2); // Simulate processing time
      
      // Generate mock data points based on query type
      const numPoints = {
        [QUERY_TYPES.LATEST_BLOCKS]: randomIntBetween(10, 100),
        [QUERY_TYPES.BLOCK_TIME_SERIES]: randomIntBetween(20, 200),
        [QUERY_TYPES.TRANSACTION_VOLUME]: randomIntBetween(20, 100),
        [QUERY_TYPES.NETWORK_STATS]: randomIntBetween(20, 100),
        [QUERY_TYPES.VALIDATOR_PERFORMANCE]: randomIntBetween(10, 50),
        [QUERY_TYPES.COMPLEX_AGGREGATION]: randomIntBetween(5, 50)
      }[queryType];
      
      // Generate mock data based on query type
      let data;
      if (queryType === QUERY_TYPES.LATEST_BLOCKS) {
        data = Array(numPoints).fill().map((_, i) => ({
          number: randomIntBetween(1000000, 9999999),
          timestamp: new Date(Date.now() - i * 3000).toISOString(),
          hash: '0x' + randomIntBetween(1000000, 9999999).toString(16).padStart(64, '0'),
          gasUsed: randomIntBetween(1000000, 5000000),
          size: randomIntBetween(1000, 50000)
        }));
      } else if (queryType === QUERY_TYPES.TRANSACTION_VOLUME) {
        data = Array(numPoints).fill().map((_, i) => ({
          time: new Date(Date.now() - i * timeRange * 1000 / numPoints).toISOString(),
          count: randomIntBetween(100, 10000),
          value: randomIntBetween(1000000, 100000000) * 1e18
        }));
      } else {
        // Generic time-series data for other query types
        data = Array(numPoints).fill().map((_, i) => ({
          time: new Date(Date.now() - i * timeRange * 1000 / numPoints).toISOString(),
          value: randomIntBetween(1, 1000)
        }));
      }
      
      response = {
        success: true,
        data: data,
        count: numPoints,
        queryTime: randomIntBetween(50, queryType === QUERY_TYPES.COMPLEX_AGGREGATION ? 2000 : 500)
      };
    }
    
    return response;
  } catch (error) {
    console.error(`Error in dashboard query (${queryType}): ${error.message}`);
    response.error = error.message;
    return response;
  } finally {
    // Record metrics
    const duration = new Date().getTime() - startTime;
    queryResponseTime.add(duration, { type: queryType });
    
    // Track complex queries separately
    if (queryType === QUERY_TYPES.COMPLEX_AGGREGATION) {
      complexQueryLatency.add(duration);
    } else {
      simpleQueryLatency.add(duration);
    }
    
    // Track success rate by query type
    querySuccessRate.add(response.success ? 1 : 0);
    
    // Track specific query types
    if (queryType.includes('block')) {
      blockQuerySuccessRate.add(response.success ? 1 : 0);
    } else if (queryType.includes('transaction')) {
      txQuerySuccessRate.add(response.success ? 1 : 0);
    } else if (queryType.includes('stats')) {
      statsQuerySuccessRate.add(response.success ? 1 : 0);
    }
    
    // Track the number of data points returned
    if (response.success && response.data) {
      const numPoints = Array.isArray(response.data) ? response.data.length : 0;
      querySize.add(numPoints, { type: queryType });
      dataPointsRetrieved.add(numPoints);
    }
  }
}

/**
 * Simulate a dashboard refresh with multiple queries using direct module testing
 * @param {object} chain - Chain configuration
 * @returns {Array} Array of query results and metadata
 */
function simulateDashboardRefresh(chain) {
  const results = [];
  const timeRanges = [300, 900, 3600, 86400, 604800]; // 5m, 15m, 1h, 24h, 7d
  const selectedTimeRange = timeRanges[Math.floor(Math.random() * timeRanges.length)];
  
  // Choose 3-6 random query types to simulate dashboard panels
  const queryTypes = Object.values(QUERY_TYPES);
  const numPanels = randomIntBetween(3, 6);
  const panelQueries = [];
  
  for (let i = 0; i < numPanels; i++) {
    const type = queryTypes[Math.floor(Math.random() * queryTypes.length)];
    panelQueries.push(type);
  }
  
  // Ensure complex query is included sometimes to stress test
  if (Math.random() > 0.7 && !panelQueries.includes(QUERY_TYPES.COMPLEX_AGGREGATION)) {
    panelQueries[Math.floor(Math.random() * panelQueries.length)] = QUERY_TYPES.COMPLEX_AGGREGATION;
  }
  
  // Track total queries for this dashboard refresh
  queriesCount.add(panelQueries.length);
  
  // Execute all dashboard panel queries
  for (const queryType of panelQueries) {
    const startTime = new Date().getTime();
    const response = testDashboardQuery(chain, queryType, selectedTimeRange);
    const duration = new Date().getTime() - startTime;
    
    queriesPerSecond.add(1 / (duration / 1000));
    
    results.push({
      type: queryType,
      success: response.success,
      numPoints: response.data ? response.data.length : 0,
      duration: duration,
      timeRange: selectedTimeRange
    });
    
    // Simulate thinking time between queries (as browsers would make requests)
    sleep(randomIntBetween(0.1, 0.5));
  }
  
  return results;
}

// Main test function
export default function() {
  const chain = utils.getRandomEnabledChain();
  
  group(`Dashboard - ${chain.name}`, function() {
    // Simulate a dashboard refresh using direct module testing
    const results = simulateDashboardRefresh(chain);
    
    // Log basic information about the dashboard refresh
    console.log(`Dashboard refresh for ${chain.name} (${chain.chainId}): ${results.length} panels queried`);
    
    // Calculate success rate
    const successfulQueries = results.filter(r => r.success).length;
    const successRate = successfulQueries / results.length;
    
    // Overall check for dashboard refresh
    check(null, {
      'dashboard refresh successful': () => successRate > 0.5,
      'panels queried': () => results.length >= 3,
      'data points retrieved': () => results.reduce((sum, r) => sum + r.numPoints, 0) > 0
    });
  });
  
  // Simulate user idle time between dashboard refreshes
  sleep(randomIntBetween(1, 5));
}
