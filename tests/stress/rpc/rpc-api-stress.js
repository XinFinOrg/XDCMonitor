/**
 * RPC API Stress Test (True Direct Module Testing)
 *
 * This script tests the RPC monitoring API layer under high load conditions
 * by directly importing and using the actual module code.
 * It simulates many clients requesting RPC status information simultaneously
 * from the API controller layer.
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
import { ApiController } from '../../../src/api/api.controller';
import { RPCController } from '../../../src/api/controllers/rpc.controller';
import { ConfigService } from '../../../src/config/config.service';
import { LoggerService } from '../../../src/logger/logger.service';

// Custom metrics
const failRate = new Rate('rpc_api_failed_requests');
const endpointChecks = new Counter('rpc_api_endpoint_checks');
const responseTime = new Trend('rpc_api_response_time');
const rpcStatusResponse = new Trend('rpc_status_response_time');
const websocketStatusResponse = new Trend('websocket_status_response_time');
const blockStatusResponse = new Trend('block_status_response_time');
const consensusStatusResponse = new Trend('consensus_status_response_time');
const transactionStatusResponse = new Trend('transaction_status_response_time');
const successRate = new Rate('rpc_api_success_rate');
const apiCallCount = new Counter('rpc_api_call_count');

// Test configuration
export const options = {
  stages: STAGES.STANDARD,
  thresholds: {
    'rpc_api_failed_requests': ['rate<0.1'],            // Error rate must be less than 10%
    'rpc_api_response_time': ['p(95)<5000'],           // 95% of requests must complete within 5s
    'rpc_status_response_time': ['p(95)<3000'],        // 95% of RPC status requests under 3s
    'websocket_status_response_time': ['p(95)<3000'],  // 95% of WebSocket status requests under 3s
    'block_status_response_time': ['p(95)<3000'],      // 95% of block status requests under 3s
    'consensus_status_response_time': ['p(95)<3000'],  // 95% of consensus status requests under 3s
    'transaction_status_response_time': ['p(95)<3000'], // 95% of transaction status requests under 3s
    'rpc_api_success_rate': ['rate>0.95'],             // 95% success rate for API calls
  },
};

// Define API endpoint types for testing
const API_ENDPOINTS = {
  RPC_STATUS: 'rpc_status',
  WEBSOCKET_STATUS: 'websocket_status',
  BLOCK_STATUS: 'block_status',
  CONSENSUS_STATUS: 'consensus_status',
  TRANSACTION_STATUS: 'transaction_status'
};

/**
 * Helper to perform true direct module testing of RPC API endpoints
 * @param {object} chain - Chain configuration
 * @param {string} endpointType - Type of API endpoint to test
 * @returns {object} Test result with response and metadata
 */
function testRpcApiEndpoint(chain, endpointType) {
  const startTime = new Date().getTime();
  let response = { success: false };
  
  // Create necessary services for the API controllers
  const configService = new ConfigService();
  const loggerService = new LoggerService(configService);
  
  // Initialize the actual API controller modules
  const apiController = new ApiController(configService, loggerService);
  const rpcController = new RPCController(configService, loggerService);
  
  // If in mock mode, don't try to use the actual module
  const isMockMode = __ENV.MOCK_MODE === 'true' || __ENV.MOCK_MODE === true;
  
  // Track API call
  apiCallCount.add(1, { endpoint: endpointType, chainId: chain.chainId });
  
  try {
    if (!isMockMode) {
      // Direct call to the actual API controller methods based on endpoint type
      switch (endpointType) {
        case API_ENDPOINTS.RPC_STATUS:
          response = rpcController.getRpcStatus({ chainId: chain.chainId });
          rpcStatusResponse.add(new Date().getTime() - startTime);
          break;
          
        case API_ENDPOINTS.WEBSOCKET_STATUS:
          response = rpcController.getWebsocketStatus({ chainId: chain.chainId });
          websocketStatusResponse.add(new Date().getTime() - startTime);
          break;
          
        case API_ENDPOINTS.BLOCK_STATUS:
          response = apiController.getBlockStatus({ chainId: chain.chainId });
          blockStatusResponse.add(new Date().getTime() - startTime);
          break;
          
        case API_ENDPOINTS.CONSENSUS_STATUS:
          response = apiController.getConsensusStatus({ chainId: chain.chainId });
          consensusStatusResponse.add(new Date().getTime() - startTime);
          break;
          
        case API_ENDPOINTS.TRANSACTION_STATUS:
          response = apiController.getTransactionStatus({ chainId: chain.chainId });
          transactionStatusResponse.add(new Date().getTime() - startTime);
          break;
          
        default:
          throw new Error(`Unknown endpoint type: ${endpointType}`);
      }
    } else {
      // Mock mode simulation
      sleep(0.2); // Simulate processing time
      
      // Create mock response based on endpoint type
      let mockData;
      
      switch (endpointType) {
        case API_ENDPOINTS.RPC_STATUS:
          mockData = {
            endpoints: Array(randomIntBetween(3, 10)).fill().map((_, i) => ({
              url: `https://rpc${i}.${chain.name.toLowerCase()}.network`,
              status: Math.random() > 0.1 ? 'online' : 'offline',
              latency: randomIntBetween(10, 500),
              lastChecked: new Date().toISOString(),
              methods: {
                eth_blockNumber: Math.random() > 0.1,
                eth_getBalance: Math.random() > 0.1
              }
            })),
            bestEndpoint: `https://rpc1.${chain.name.toLowerCase()}.network`,
            lastUpdated: new Date().toISOString()
          };
          rpcStatusResponse.add(new Date().getTime() - startTime);
          break;
          
        case API_ENDPOINTS.WEBSOCKET_STATUS:
          mockData = {
            endpoints: Array(randomIntBetween(1, 5)).fill().map((_, i) => ({
              url: `wss://ws${i}.${chain.name.toLowerCase()}.network`,
              status: Math.random() > 0.1 ? 'online' : 'offline',
              latency: randomIntBetween(5, 200),
              lastChecked: new Date().toISOString(),
              connections: randomIntBetween(10, 1000)
            })),
            bestEndpoint: `wss://ws0.${chain.name.toLowerCase()}.network`,
            lastUpdated: new Date().toISOString()
          };
          websocketStatusResponse.add(new Date().getTime() - startTime);
          break;
          
        case API_ENDPOINTS.BLOCK_STATUS:
          mockData = {
            lastBlock: randomIntBetween(1000000, 9999999),
            blockTime: randomIntBetween(2, 15),
            blocksPerDay: randomIntBetween(5000, 10000),
            lastBlockTime: new Date().toISOString(),
            syncStatus: Math.random() > 0.05 ? 'synced' : 'syncing'
          };
          blockStatusResponse.add(new Date().getTime() - startTime);
          break;
          
        case API_ENDPOINTS.CONSENSUS_STATUS:
          mockData = {
            validators: {
              total: randomIntBetween(50, 200),
              active: randomIntBetween(30, 50),
              inactive: randomIntBetween(0, 10)
            },
            currentEpoch: randomIntBetween(1000, 2000),
            epochProgress: randomIntBetween(1, 100),
            nextEpochTime: new Date(Date.now() + randomIntBetween(1, 86400) * 1000).toISOString()
          };
          consensusStatusResponse.add(new Date().getTime() - startTime);
          break;
          
        case API_ENDPOINTS.TRANSACTION_STATUS:
          mockData = {
            tps: randomIntBetween(1, 100),
            pendingTx: randomIntBetween(0, 1000),
            avgConfirmTime: randomIntBetween(1, 60),
            dailyTx: randomIntBetween(10000, 1000000),
            gasPrice: randomIntBetween(1, 100)
          };
          transactionStatusResponse.add(new Date().getTime() - startTime);
          break;
      }
      
      response = {
        success: true,
        status: 200,
        data: mockData,
        timestamp: new Date().toISOString()
      };
    }
    
    // Record success
    successRate.add(1);
    failRate.add(0, { endpoint: endpointType, chainId: chain.chainId });
    
    return response;
  } catch (error) {
    // Record failure
    console.error(`Error in RPC API (${endpointType}): ${error.message}`);
    failRate.add(1, { endpoint: endpointType, chainId: chain.chainId });
    successRate.add(0);
    
    response.error = error.message;
    return response;
  } finally {
    // Always record response time
    responseTime.add(new Date().getTime() - startTime, { 
      endpoint: endpointType, 
      chainId: chain.chainId, 
      network: chain.name 
    });
    
    // Track endpoint check
    endpointChecks.add(1, { 
      endpoint: endpointType, 
      chainId: chain.chainId, 
      network: chain.name 
    });
  }
}

// Main test function
export default function() {
  // Select a random enabled chain
  const chain = utils.getRandomEnabledChain();

  // Select a random endpoint type to test
  const endpointTypes = Object.values(API_ENDPOINTS);
  const endpointType = endpointTypes[Math.floor(Math.random() * endpointTypes.length)];
  
  group(`RPC API - ${chain.name} - ${endpointType}`, function() {
    // Call the direct module testing function
    const response = testRpcApiEndpoint(chain, endpointType);
    
    // Log basic information about the process
    console.log(`API call ${endpointType} for ${chain.name} (${chain.chainId}): ${response.success ? 'SUCCESS' : 'FAILED'}`);
    
    // Additional check for response
    check(response, {
      'operation succeeded': (r) => r.success === true,
      'valid data returned': (r) => r.data !== undefined,
      'timestamp included': (r) => r.timestamp !== undefined
    });
  });
  
  // Simulate variable client behavior with random pauses
  sleep(randomIntBetween(1, 5) / 10);
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
