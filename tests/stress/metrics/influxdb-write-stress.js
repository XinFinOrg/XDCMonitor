/**
 * InfluxDB Write Performance Stress Test (True Direct Module Testing)
 * 
 * This script tests the actual MetricsService's ability to handle high volumes of metrics
 * writes to InfluxDB, simulating high blockchain activity scenarios by directly
 * importing and using the actual module code.
 *
 * Focus areas:
 * - Batch metrics writing performance
 * - Write throughput under load
 * - Error handling during write failures
 * - Memory usage during high metrics volume
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
import { generateMetricsBatch } from '../utils/data-generators.js';
import { mockRequest } from '../utils/mock-server.js';

// DIRECT MODULE IMPORTS - Import the actual modules from the codebase
import { MetricsService } from '../../../src/metrics/metrics.service';
import { ConfigService } from '../../../src/config/config.service';
import { LoggerService } from '../../../src/logger/logger.service';

// Custom metrics
const writeLatency = new Trend('influxdb_write_latency');
const batchSize = new Trend('influxdb_batch_size');
const pointsWritten = new Counter('influxdb_points_written');
const failedWrites = new Counter('influxdb_failed_writes');
const successfulBatches = new Counter('influxdb_successful_batches');
const successRate = new Rate('influxdb_write_success_rate');
const blockMetricsRate = new Rate('influxdb_block_metrics_success_rate');
const txMetricsRate = new Rate('influxdb_tx_metrics_success_rate');
const rpcMetricsRate = new Rate('influxdb_rpc_metrics_success_rate');

// Configure the load test
export const options = {
  stages: STAGES.STANDARD,
  thresholds: {
    'influxdb_write_latency{type:block}': ['p(95)<2000'],
    'influxdb_write_latency{type:transaction}': ['p(95)<2000'],
    'influxdb_write_latency{type:rpc}': ['p(95)<2000'],
    'influxdb_write_success_rate': ['rate>0.98'],
    'influxdb_block_metrics_success_rate': ['rate>0.98'],
    'influxdb_tx_metrics_success_rate': ['rate>0.98'],
    'influxdb_rpc_metrics_success_rate': ['rate>0.98'],
  },
};

/**
 * Helper to perform true direct module testing of metrics writing to InfluxDB
 * @param {object} chain - Chain configuration
 * @param {Array} metricsBatch - Batch of metrics to write
 * @returns {object} Test result with response and metadata
 */
function testMetricsWrite(chain, metricsBatch) {
  const startTime = new Date().getTime();
  let response = { success: false };
  
  // Create necessary services for the MetricsService
  const configService = new ConfigService();
  const loggerService = new LoggerService(configService);
  
  // Initialize the actual MetricsService module
  const metricsService = new MetricsService(configService, loggerService);
  
  // If in mock mode, don't try to use the actual module
  const isMockMode = __ENV.MOCK_MODE === 'true' || __ENV.MOCK_MODE === true;
  
  try {
    if (!isMockMode) {
      // Direct call to the actual MetricsService module
      response = metricsService.writeMetricsBatch(chain.chainId, metricsBatch);
    } else {
      // Mock mode simulation
      sleep(0.1); // Simulate processing time
      
      // Create mock success response
      response = {
        success: true,
        batchSize: metricsBatch.length,
        pointsWritten: metricsBatch.reduce((sum, m) => sum + (m.fields ? Object.keys(m.fields).length : 1), 0),
        writeTime: randomIntBetween(10, 500),
        timestamp: new Date().toISOString()
      };
    }
    
    return response;
  } catch (error) {
    console.error(`Error in metrics writing: ${error.message}`);
    response.error = error.message;
    return response;
  } finally {
    // Record the latency regardless of success/failure
    writeLatency.add(new Date().getTime() - startTime, { type: 'batch' });
    
    // Categorize metrics by type for detailed monitoring
    metricsBatch.forEach(metric => {
      const metricType = metric.measurement.replace('xdc_', '').replace('_metrics', '');
      writeLatency.add((new Date().getTime() - startTime) / metricsBatch.length, { type: metricType });
      
      // Track success rate by metric type
      if (metricType === 'block') {
        blockMetricsRate.add(response.success ? 1 : 0);
      } else if (metricType === 'transaction') {
        txMetricsRate.add(response.success ? 1 : 0);
      } else if (metricType === 'rpc') {
        rpcMetricsRate.add(response.success ? 1 : 0);
      }
    });
  }
}

// Main test function
export default function() {
  const chain = utils.getRandomEnabledChain();
  const batchSizeVal = randomIntBetween(5, 50);
  const metricsBatch = generateMetricsBatch(chain, batchSizeVal);
  
  batchSize.add(batchSizeVal);
  
  group(`InfluxDB Write - ${chain.name}`, function() {
    // Call the direct module testing function
    const response = testMetricsWrite(chain, metricsBatch);
    
    // Log basic information about the process
    console.log(`Wrote metrics batch for ${chain.name} (${chain.chainId}): ${response.success ? 'SUCCESS' : 'FAILED'}, batch size: ${batchSizeVal}`);
    
    // Record metrics about the test result
    if (response.success) {
      successfulBatches.add(1);
      pointsWritten.add(response.pointsWritten || batchSizeVal);
    } else {
      failedWrites.add(batchSizeVal);
    }
    
    successRate.add(response.success ? 1 : 0);
    
    // Perform checks on the response
    check(response, {
      'write operation succeeded': (r) => r.success === true,
      'all points written': (r) => r.pointsWritten >= batchSizeVal || r.batchSize >= batchSizeVal
    });
  });
  
  // Sleep a bit to avoid overwhelming InfluxDB
  sleep(randomIntBetween(1, 5) / 10);
}
