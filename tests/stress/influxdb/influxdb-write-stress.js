/**
 * InfluxDB Write Performance Stress Test
 * 
 * This script tests the MetricsService's ability to handle high volumes of metrics
 * writes to InfluxDB, simulating high blockchain activity scenarios.
 */

import { sleep, check } from 'k6';
import http from 'k6/http';
import { Counter, Trend, Rate } from 'k6/metrics';
import { randomIntBetween } from 'https://jslib.k6.io/k6-utils/1.2.0/index.js';

import {
  BASE_URL,
  CHAINS,
  THRESHOLDS,
  STAGES,
  utils
} from '../config.js';

// Custom metrics
const writeLatency = new Trend('influxdb_write_latency');
const batchSize = new Trend('influxdb_batch_size');
const failedWrites = new Counter('influxdb_failed_writes');
const successRate = new Rate('influxdb_write_success_rate');

// Configure the load test
export const options = {
  stages: STAGES.STANDARD,
  thresholds: {
    'influxdb_write_latency{type:block}': ['p95<2000'],
    'influxdb_write_latency{type:transaction}': ['p95<2000'],
    'influxdb_write_latency{type:rpc}': ['p95<2000'],
    'influxdb_write_success_rate': ['rate>0.99'],
    'http_req_failed': ['rate<0.01'],
    'http_req_duration': ['p95<2000'],
  },
};

// Helper function to generate fake metrics data
function generateMetricsPayload(type, chain) {
  const timestamp = new Date().toISOString();
  const tags = {
    chainId: chain.chainId,
    network: chain.name
  };
  
  let values = {};
  
  switch (type) {
    case 'block':
      values = {
        blockHeight: randomIntBetween(1000000, 9999999),
        blockTime: randomIntBetween(2, 15),
        transactionCount: randomIntBetween(0, 100),
        size: randomIntBetween(1000, 100000)
      };
      break;
    case 'transaction':
      values = {
        count: randomIntBetween(1, 100),
        gasUsed: randomIntBetween(21000, 10000000),
        successRate: Math.random(),
        averageConfirmationTime: randomIntBetween(2, 30)
      };
      break;
    case 'rpc':
      values = {
        latency: randomIntBetween(50, 2000),
        successRate: Math.random(),
        errorCount: randomIntBetween(0, 10),
        requestCount: randomIntBetween(10, 1000)
      };
      break;
    default:
      values = { value: Math.random() * 100 };
  }
  
  return {
    measurement: `xdc_${type}_metrics`,
    tags,
    timestamp,
    fields: values
  };
}

// Generate a batch of metrics data
function generateMetricsBatch(chain, batchSize = 10) {
  const metricTypes = ['block', 'transaction', 'rpc', 'consensus'];
  const batch = [];
  
  for (let i = 0; i < batchSize; i++) {
    // Randomly select a metric type
    const type = metricTypes[Math.floor(Math.random() * metricTypes.length)];
    batch.push(generateMetricsPayload(type, chain));
  }
  
  return batch;
}

// Main test function
export default function() {
  const chain = utils.getRandomEnabledChain();
  const batchSizeVal = randomIntBetween(5, 50);
  const metricsBatch = generateMetricsBatch(chain, batchSizeVal);
  
  batchSize.add(batchSizeVal);
  
  // Using a custom endpoint that will write to InfluxDB without blockchain interaction
  // This simulates the internal MetricsService.recordMetrics() functionality
  const response = http.post(
    `${BASE_URL}/api/testing/metrics/batch-write`,
    JSON.stringify(metricsBatch),
    {
      headers: { 'Content-Type': 'application/json' },
      tags: { chain: chain.name, type: 'metrics_write' }
    }
  );
  
  // Record metrics about the test
  writeLatency.add(response.timings.duration, { type: 'batch' });
  
  // For individual metric types, record specific latency metrics
  metricsBatch.forEach(metric => {
    writeLatency.add(response.timings.duration / batchSizeVal, { 
      type: metric.measurement.replace('xdc_', '').replace('_metrics', '') 
    });
  });
  
  const success = check(response, {
    'write successful': (r) => r.status === 200 || r.status === 201
  });
  
  if (!success) {
    failedWrites.add(batchSizeVal);
  }
  
  successRate.add(success);
  
  // Simulate varying load patterns
  sleep(randomIntBetween(0.1, 2));
}
