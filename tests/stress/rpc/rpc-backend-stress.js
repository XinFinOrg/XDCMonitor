/**
 * RPC Backend Processing Stress Test (True Direct Module Testing)
 *
 * This script tests the actual RPC monitoring service under high load by directly
 * importing and using the actual module code.
 *
 * Focus areas:
 * - RPC service scan scheduling
 * - Endpoint health calculation
 * - Failover mechanisms
 * - High volume endpoint checking
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
// Note: These paths may need adjustment based on the actual project structure
import { RPCMonitor } from '../../../src/monitoring/rpc/rpc.monitor';
import { EndpointHealthService } from '../../../src/monitoring/rpc/endpoint-health.service';
import { ConfigService } from '../../../src/config/config.service';
import { LoggerService } from '../../../src/logger/logger.service';
import { Web3Service } from '../../../src/blockchain/web3.service';

// Custom metrics
const scanLatency = new Trend('rpc_backend_scan_latency');
const healthCalculationTime = new Trend('rpc_health_calculation_time');
const failoverTime = new Trend('rpc_failover_time');
const endpointScanThroughput = new Counter('rpc_endpoint_scan_throughput');
const endpointCheckedCount = new Counter('rpc_endpoint_checked_count');
const failoverCount = new Counter('rpc_failover_count');
const healthRecalcCount = new Counter('rpc_health_recalc_count');
const rpcCallSuccessRate = new Rate('rpc_call_success_rate');
const healthCheckSuccessRate = new Rate('rpc_health_check_success_rate');
const failoverSuccessRate = new Rate('rpc_failover_success_rate');

// Test configuration
export const options = {
  stages: STAGES.STANDARD,
  thresholds: {
    'rpc_backend_scan_latency': ['p(95)<5000'],  // 95% of backend scans under 5s
    'rpc_health_calculation_time': ['p(95)<1000'], // 95% of health calculations under 1s
    'rpc_failover_time': ['p(95)<3000'], // 95% of failovers under 3s
    'rpc_call_success_rate': ['rate>0.95'], // 95% success rate for RPC operations
    'rpc_health_check_success_rate': ['rate>0.95'], // 95% success rate for health checks
    'rpc_failover_success_rate': ['rate>0.9'], // 90% success rate for failovers
  },
};

// Generate realistic RPC endpoint data
function generateEndpointData(chain, count = 5) {
  const endpoints = [];
  
  for (let i = 0; i < count; i++) {
    endpoints.push({
      url: `https://rpc${i}.example.${chain.name.toLowerCase()}.network`,
      isHealthy: Math.random() > 0.2, // 80% healthy
      lastChecked: new Date().toISOString(),
      responseTime: randomIntBetween(50, 2000),
      methods: {
        eth_blockNumber: Math.random() > 0.1,
        eth_getBalance: Math.random() > 0.1,
        eth_sendRawTransaction: Math.random() > 0.15,
        net_version: Math.random() > 0.05
      },
      errors: randomIntBetween(0, 5),
      successRate: Math.random() * 0.3 + 0.7, // 70-100% success rate
    });
  }
  
  return endpoints;
}

/**
 * Helper to perform true direct module testing of RPC backend processing
 * @param {object} chain - Chain configuration
 * @param {string} processType - Type of process to test
 * @returns {object} Test result with response and metadata
 */
function testRpcBackendProcess(chain, processType) {
  const startTime = new Date().getTime();
  let response = { success: false };
  
  // Create necessary services for the RPC Monitor
  const configService = new ConfigService();
  const loggerService = new LoggerService(configService);
  const web3Service = new Web3Service(configService, loggerService);
  
  // Initialize the actual monitor modules
  const rpcMonitor = new RPCMonitor(configService, loggerService, web3Service);
  const endpointHealthService = new EndpointHealthService(configService, loggerService);
  
  // If in mock mode, don't try to use the actual module
  const isMockMode = __ENV.MOCK_MODE === 'true' || __ENV.MOCK_MODE === true;
  
  try {
    switch (processType) {
      case 'scan':
        // Process an RPC endpoint scan
        const endpointCount = randomIntBetween(3, 10);
        const endpoints = generateEndpointData(chain, endpointCount);
        const checkAllMethods = Math.random() > 0.7; // Sometimes do a deep check
        
        if (!isMockMode) {
          // Direct call to the actual RPCMonitor module
          response = rpcMonitor.scanEndpoints(chain.chainId, checkAllMethods);
        } else {
          // Mock mode simulation
          sleep(0.3); // Simulate processing time
          
          // Calculate success metrics based on the generated endpoints
          const successfulChecks = endpoints.reduce((sum, e) => sum + Math.round(e.successRate * 5), 0);
          const totalChecks = endpoints.length * 5; // Assume 5 methods per endpoint
          
          response = {
            success: true,
            endpoints: endpoints,
            endpointCount: endpoints.length,
            methodsChecked: checkAllMethods ? totalChecks : Math.floor(totalChecks / 2),
            successfulChecks: successfulChecks,
            failedChecks: totalChecks - successfulChecks,
            scanDuration: randomIntBetween(200, 3000),
            timestamp: new Date().toISOString()
          };
        }
        
        scanLatency.add(new Date().getTime() - startTime);
        endpointScanThroughput.add(endpointCount);
        endpointCheckedCount.add(response.endpoints.length);
        rpcCallSuccessRate.add(response.success ? 1 : 0);
        
        check(response, {
          'scan completed successfully': (r) => r.success === true,
          'endpoints processed': (r) => r.endpoints && r.endpoints.length > 0,
          'methods checked': (r) => r.methodsChecked > 0
        });
        break;
        
      case 'health':
        // Calculate health for a set of endpoints
        const healthEndpointCount = randomIntBetween(5, 15);
        const healthEndpoints = generateEndpointData(chain, healthEndpointCount);
        const timeWindow = ['1h', '24h', '7d'][Math.floor(Math.random() * 3)];
        
        if (!isMockMode) {
          // Direct call to the actual EndpointHealthService module
          response = endpointHealthService.calculateEndpointHealth(chain.chainId, timeWindow);
        } else {
          // Mock mode simulation
          sleep(0.2); // Simulate processing time
          
          // Calculate health metrics for each endpoint
          const healthResults = healthEndpoints.map(endpoint => ({
            url: endpoint.url,
            healthScore: Math.random() * 100,
            responseTime: randomIntBetween(50, 500),
            availability: endpoint.successRate * 100,
            uptime: randomIntBetween(90, 100),
            lastChecked: new Date().toISOString()
          }));
          
          response = {
            success: true,
            timeWindow: timeWindow,
            healthResults: healthResults,
            averageHealth: healthResults.reduce((sum, r) => sum + r.healthScore, 0) / healthResults.length,
            bestEndpoint: healthResults.sort((a, b) => b.healthScore - a.healthScore)[0],
            calculationTime: randomIntBetween(50, 300),
            timestamp: new Date().toISOString()
          };
        }
        
        healthCalculationTime.add(new Date().getTime() - startTime);
        healthRecalcCount.add(1);
        healthCheckSuccessRate.add(response.success ? 1 : 0);
        
        check(response, {
          'health calculation successful': (r) => r.success === true,
          'health results generated': (r) => r.healthResults && r.healthResults.length > 0,
          'best endpoint identified': (r) => r.bestEndpoint !== undefined
        });
        break;
        
      case 'failover':
        // Process a failover event
        const failingEndpoint = {
          url: `https://node${randomIntBetween(1, 100)}.${chain.name}.network`,
          isPublic: Math.random() > 0.5,
          status: 'failing',
          lastChecked: new Date().toISOString(),
          consecutiveFailures: randomIntBetween(3, 10)
        };
        
        const availableEndpoints = generateEndpointData(chain, randomIntBetween(2, 5));
        
        if (!isMockMode) {
          // Direct call to the actual RPCMonitor module
          response = rpcMonitor.handleEndpointFailover(chain.chainId, failingEndpoint.url);
        } else {
          // Mock mode simulation
          sleep(0.4); // Simulate processing time
          
          // Sort available endpoints by success rate to find the best one
          const sortedEndpoints = [...availableEndpoints].sort((a, b) => b.successRate - a.successRate);
          const selectedEndpoint = sortedEndpoints[0];
          
          response = {
            success: true,
            failedEndpoint: failingEndpoint,
            selectedEndpoint: selectedEndpoint,
            candidateEndpoints: sortedEndpoints.length,
            switchoverTime: randomIntBetween(100, 1000),
            timestamp: new Date().toISOString()
          };
        }
        
        failoverTime.add(new Date().getTime() - startTime);
        failoverCount.add(1);
        failoverSuccessRate.add(response.success ? 1 : 0);
        
        check(response, {
          'failover completed successfully': (r) => r.success === true,
          'new endpoint selected': (r) => r.selectedEndpoint !== undefined
        });
        break;
    }
  } catch (error) {
    console.error(`Error in RPC backend processing (${processType}): ${error.message}`);
    response.error = error.message;
  }
  
  return response;
}

// Primary test function
export default function() {
  const chain = utils.getRandomEnabledChain();
  
  // Choose a random process type to test
  const processTypes = ['scan', 'health', 'failover'];
  const processType = processTypes[Math.floor(Math.random() * processTypes.length)];
  
  group(`RPC Backend - ${chain.name} - ${processType}`, function() {
    // Call the direct module testing function
    const response = testRpcBackendProcess(chain, processType);
    
    // Log basic information about the process
    console.log(`Processed ${processType} for ${chain.name} (${chain.chainId}): ${response.success ? 'SUCCESS' : 'FAILED'}`);
    
    // Additional check for common response properties across all process types
    check(response, {
      'operation succeeded': (r) => r.success === true,
      'timestamp recorded': (r) => r.timestamp !== undefined
    });
  });
  
  // Add variable sleep to simulate real-world usage patterns and prevent overloading
  sleep(randomIntBetween(1, 5) / 10);
}
