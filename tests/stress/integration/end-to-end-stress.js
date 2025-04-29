/**
 * End-to-End Stress Test
 * 
 * This test simulates the complete monitoring flow:
 * 1. Backend processing of blockchain activity
 * 2. Storage of metrics in InfluxDB
 * 3. Query of metrics for dashboard displays
 * 
 * It helps identify bottlenecks in the complete pipeline rather than in isolated components.
 */

import { sleep, check, group } from 'k6';
import http from 'k6/http';
import { Trend, Rate, Counter } from 'k6/metrics';
import { randomIntBetween } from 'https://jslib.k6.io/k6-utils/1.2.0/index.js';

import {
  BASE_URL,
  CHAINS,
  THRESHOLDS,
  STAGES,
  ENDPOINTS,
  utils
} from '../config.js';

// Custom metrics for each stage of the pipeline
const eventGenerationTime = new Trend('e2e_event_generation_time');
const metricStorageTime = new Trend('e2e_metric_storage_time');
const metricQueryTime = new Trend('e2e_metric_query_time');
const endToEndLatency = new Trend('e2e_total_latency');
const processingSuccessRate = new Rate('e2e_success_rate');
const dashboardQueriesPerSecond = new Counter('dashboard_queries_per_second');

// Configure the test with a moderate profile to allow for end-to-end measurement
export const options = {
  // Use a shorter profile as end-to-end tests are more intensive
  stages: [
    { duration: '1m', target: 5 },
    { duration: '3m', target: 10 },
    { duration: '5m', target: 20 },
    { duration: '1m', target: 0 },
  ],
  thresholds: {
    'e2e_total_latency': ['p95<10000'], // End-to-end should complete in under 10s for p95
    'e2e_success_rate': ['rate>0.95'],   // 95% success rate for full pipeline
    'e2e_metric_storage_time': ['p95<3000'], // InfluxDB writes under 3s
    'e2e_metric_query_time': ['p95<1000'],   // Queries under 1s for dashboard experience
    'http_req_failed': ['rate<0.05'],
  },
};

// Helper to generate a realistic blockchain event
function generateBlockchainEvent(chain) {
  const eventTypes = ['new_block', 'large_transaction_batch', 'contract_interaction', 'consensus_update'];
  const eventType = eventTypes[Math.floor(Math.random() * eventTypes.length)];
  
  const blockNumber = randomIntBetween(1000000, 9999999);
  const timestamp = new Date().toISOString();
  
  let eventData = {
    chainId: chain.chainId,
    network: chain.name,
    eventType,
    timestamp,
    blockNumber,
  };
  
  // Add event-specific data
  switch (eventType) {
    case 'new_block':
      eventData = {
        ...eventData,
        transactionCount: randomIntBetween(5, 100),
        blockTime: randomIntBetween(2, 15),
        size: randomIntBetween(10000, 500000),
      };
      break;
    case 'large_transaction_batch':
      const txCount = randomIntBetween(50, 300);
      const transactions = [];
      for (let i = 0; i < 5; i++) { // Only include sample transactions, not all for performance
        transactions.push({
          hash: '0x' + randomIntBetween(1, 999999999).toString(16).padStart(64, '0'),
          from: '0x' + randomIntBetween(1, 999999).toString(16).padStart(40, '0'),
          to: '0x' + randomIntBetween(1, 999999).toString(16).padStart(40, '0'),
          value: randomIntBetween(0, 1000000).toString(),
        });
      }
      eventData = {
        ...eventData,
        totalTxCount: txCount,
        sampleTransactions: transactions,
      };
      break;
    case 'contract_interaction':
      eventData = {
        ...eventData,
        contractAddress: '0x' + randomIntBetween(1, 999999).toString(16).padStart(40, '0'),
        methodId: '0x' + randomIntBetween(1, 0xffffffff).toString(16).padStart(8, '0'),
        callData: '0x' + 'f'.repeat(randomIntBetween(10, 1000) * 2),
        gasUsed: randomIntBetween(50000, 8000000),
      };
      break;
    case 'consensus_update':
      eventData = {
        ...eventData,
        validatorCount: randomIntBetween(50, 150),
        activeValidators: randomIntBetween(40, 150),
        proposerIndex: randomIntBetween(0, 50),
        epoch: randomIntBetween(1000, 10000),
      };
      break;
  }
  
  return { eventType, eventData };
}

// Primary test function
export default function() {
  const chain = utils.getRandomEnabledChain();
  
  // Track overall execution time for end-to-end measurement
  const startTime = new Date().getTime();
  let success = true;
  
  // STEP 1: Generate blockchain event and trigger processing
  group('Step 1: Blockchain Event Processing', function() {
    const eventStartTime = new Date().getTime();
    const { eventType, eventData } = generateBlockchainEvent(chain);
    
    const response = http.post(
      `${BASE_URL}/api/testing/events/simulate`,
      JSON.stringify(eventData),
      {
        headers: { 'Content-Type': 'application/json' },
        tags: { chain: chain.name, type: eventType, step: 'event_processing' }
      }
    );
    
    success = success && check(response, {
      'event processing successful': (r) => r.status === 200 || r.status === 201
    });
    
    // Store event ID for subsequent steps
    let eventId = '';
    try {
      const responseBody = JSON.parse(response.body);
      eventId = responseBody.eventId || '';
    } catch (e) {
      console.log('Failed to parse event response:', e);
      success = false;
    }
    
    eventGenerationTime.add(new Date().getTime() - eventStartTime);
    
    // Short delay to allow processing to start
    sleep(0.5);
    
    // STEP 2: Check metrics storage for the event
    group('Step 2: Metrics Storage', function() {
      if (!eventId) {
        console.log('Skipping metrics check due to missing eventId');
        return;
      }
      
      const metricsStartTime = new Date().getTime();
      
      // Query the metrics write status endpoint
      const metricsResponse = http.get(
        `${BASE_URL}/api/testing/metrics/status?eventId=${eventId}`,
        {
          tags: { chain: chain.name, type: eventType, step: 'metrics_storage' }
        }
      );
      
      success = success && check(metricsResponse, {
        'metrics storage successful': (r) => r.status === 200,
        'metrics stored in InfluxDB': (r) => {
          try {
            const body = JSON.parse(r.body);
            return body.stored === true;
          } catch (e) {
            return false;
          }
        }
      });
      
      metricStorageTime.add(new Date().getTime() - metricsStartTime);
    });
    
    // Longer delay to allow metrics to be stored
    sleep(1);
  });
  
  // STEP 3: Simulate dashboard queries
  group('Step 3: Dashboard Queries', function() {
    const queryStartTime = new Date().getTime();
    
    // Simulate different types of dashboard queries
    const queryTypes = [
      'latest_blocks',
      'transaction_volume',
      'network_health', 
      'validator_status',
      'gas_usage'
    ];
    
    // Select a few random query types to simulate realistic dashboard load
    const selectedQueries = [];
    const queryCount = randomIntBetween(1, 3);
    
    for (let i = 0; i < queryCount; i++) {
      const randomIndex = Math.floor(Math.random() * queryTypes.length);
      selectedQueries.push(queryTypes[randomIndex]);
    }
    
    // Execute each selected query
    for (const queryType of selectedQueries) {
      const timeRange = randomIntBetween(1, 24); // Hours
      
      const queryResponse = http.get(
        `${BASE_URL}/api/testing/dashboard/query?type=${queryType}&chainId=${chain.chainId}&timeRange=${timeRange}h`,
        {
          tags: { chain: chain.name, query: queryType, step: 'dashboard_query' }
        }
      );
      
      success = success && check(queryResponse, {
        'dashboard query successful': (r) => r.status === 200,
        'query returned data': (r) => {
          try {
            const body = JSON.parse(r.body);
            return body.data && body.data.length > 0;
          } catch (e) {
            return false;
          }
        }
      });
    }
    
    metricQueryTime.add(new Date().getTime() - queryStartTime);
    dashboardQueriesPerSecond.add(selectedQueries.length);
  });
  
  // Record overall end-to-end latency
  const totalTime = new Date().getTime() - startTime;
  endToEndLatency.add(totalTime);
  processingSuccessRate.add(success);
  
  // Realistic sleep between test iterations
  sleep(randomIntBetween(1, 3));
}
