/**
 * Blocks Backend Processing Stress Test (True Direct Module Testing)
 *
 * This script tests the actual BlocksMonitor service under high load
 * by directly importing and using the actual module code.
 *
 * Focus areas:
 * - Block processing and scanning logic
 * - Time window analysis for block times
 * - Transaction batch processing
 * - Multiple endpoint handling and discrepancy detection
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
import { BlocksMonitor } from '../../../src/monitoring/blocks/blocks.monitor';
import { ConfigService } from '../../../src/config/config.service';
import { LoggerService } from '../../../src/logger/logger.service';
import { Web3Service } from '../../../src/blockchain/web3.service';

// Mock imports for MOCK_MODE
import { generateBlock } from '../utils/blocks-simulator.js';

// Custom metrics
const blockProcessingTime = new Trend('block_backend_processing_time');
const blockTimeAnalysisTime = new Trend('block_time_analysis_time');
const txBatchProcessingTime = new Trend('tx_batch_processing_time');
const blockProcessingThroughput = new Counter('block_processing_throughput');
const txProcessingThroughput = new Counter('tx_processing_throughput');
const processingSuccessRate = new Rate('block_processing_success_rate');

// Test configuration
export const options = {
  stages: STAGES.STANDARD,
  thresholds: {
    'block_backend_processing_time': ['p(95)<3000'],  // 95% of block processing under 3s
    'block_time_analysis_time': ['p(95)<2000'],       // 95% of time analysis under 2s
    'tx_batch_processing_time': ['p(95)<5000'],       // 95% of tx batch processing under 5s
    'block_processing_success_rate': ['rate>0.95'],   // 95% success rate
    'http_req_failed': ['rate<0.05'],                 // Overall HTTP failure rate under 5%
  },
};

/**
 * Helper to generate a series of blocks for time window analysis
 * @param {object} chain - Chain configuration
 * @param {number} count - Number of blocks to generate
 * @param {number} intervalVariance - Variance in block times (0-1)
 * @returns {Array} Series of blocks
 */
function generateBlockSeries(chain, count = 10, intervalVariance = 0.3) {
  const series = [];
  let lastTimestamp = Math.floor(Date.now() / 1000) - (count * 15); // Starting ~15s per block ago
  
  for (let i = 0; i < count; i++) {
    const blockNumber = 1000000 + i;
    const txCount = randomIntBetween(0, 30);
    
    // Add some variance to block times
    const intervalSecs = 15 * (1 + (Math.random() * intervalVariance * 2 - intervalVariance));
    lastTimestamp += Math.floor(intervalSecs);
    
    const block = generateBlock({
      chainId: chain.chainId,
      blockNumber,
      txCount,
    });
    
    block.timestamp = lastTimestamp;
    series.push(block);
  }
  
  return series;
}

/**
 * Test block processing using true direct module testing
 * @param {object} chain - Chain configuration
 * @param {string} processType - Type of block processing to simulate
 * @returns {object} Simulation results
 */
function testBlocksBackendProcess(chain, processType) {
  const startTime = new Date().getTime();
  let response = { success: false };
  
  // Create necessary services for the BlocksMonitor
  const configService = new ConfigService();
  const loggerService = new LoggerService(configService);
  const web3Service = new Web3Service(configService, loggerService);
  
  // Initialize the actual BlocksMonitor module
  const blocksMonitor = new BlocksMonitor(
    configService,
    loggerService,
    web3Service
  );
  
  // If in mock mode, don't try to use the actual module
  const isMockMode = __ENV.MOCK_MODE === 'true' || __ENV.MOCK_MODE === true;
  
  // Determine what type of processing to test
  try {
    switch (processType) {
      case 'single_block':
        // Generate a sample block
        const block = isMockMode ? 
          generateBlock({ chainId: chain.chainId }) : 
          web3Service.getBlock(chain.chainId, 'latest');
        
        // Directly call the actual module function
        if (!isMockMode) {
          response = blocksMonitor.processBlock(block, chain.chainId);
          
          blockProcessingTime.add(response.processingTime || 0);
          blockProcessingThroughput.add(1);
          txProcessingThroughput.add(block.transactions ? block.transactions.length : 0);
          
          check(response, {
            'request successful': (r) => r !== null,
            'valid response': (r) => r.success === true
          });
          
          processingSuccessRate.add(response.success ? 1 : 0);
        } else {
          // Mock mode simulation
          sleep(0.1); // Simulate processing time
          response = { 
            success: true, 
            blockNumber: block.number,
            processingTime: 50,
            transactionsProcessed: block.transactions ? block.transactions.length : 0
          };
          processingSuccessRate.add(1);
        }
        break;
        
      case 'block_time_analysis':
        // Get a series of blocks for time window analysis
        const blocks = isMockMode ?
          generateBlockSeries(chain, 20) :
          web3Service.getBlocks(chain.chainId, 20);
        
        // Perform time window analysis
        const analysisStartTime = new Date().getTime();
        
        if (!isMockMode) {
          response = blocksMonitor.analyzeBlockTimes(blocks, chain.chainId);
        } else {
          // Mock mode simulation
          sleep(0.2); // Simulate processing time
          const avgBlockTime = 15; // 15 seconds average block time
          response = {
            success: true,
            timeWindowData: blocks.map(b => ({ 
              blockNumber: b.number, 
              blockTime: randomIntBetween(2, 5) 
            })),
            averageBlockTime: avgBlockTime,
            minBlockTime: avgBlockTime * 0.7,
            maxBlockTime: avgBlockTime * 1.3
          };
        }
        
        blockTimeAnalysisTime.add(new Date().getTime() - analysisStartTime);
        
        check(response, {
          'request successful': (r) => r !== null,
          'valid response': (r) => r.success === true,
          'time analysis data present': (r) => r.timeWindowData && r.timeWindowData.length > 0
        });
        break;
        
      case 'tx_batch':
        // Process a block with many transactions
        const largeBlock = isMockMode ?
          generateBlock({ chainId: chain.chainId, txCount: randomIntBetween(100, 500) }) :
          web3Service.getBlockWithTransactions(chain.chainId, 'latest');
        
        const batchStartTime = new Date().getTime();
        
        if (!isMockMode) {
          response = blocksMonitor.processTransactionBatch(largeBlock.transactions, chain.chainId);
        } else {
          // Mock mode simulation
          sleep(0.3); // Simulate processing time
          response = {
            success: true,
            transactionsProcessed: largeBlock.transactions.length,
            confirmedTransactions: Math.floor(largeBlock.transactions.length * 0.95),
            failedTransactions: Math.floor(largeBlock.transactions.length * 0.05),
            processingTime: randomIntBetween(100, 300)
          };
        }
        
        txBatchProcessingTime.add(new Date().getTime() - batchStartTime);
        txProcessingThroughput.add(largeBlock.transactions.length);
        
        check(response, {
          'request successful': (r) => r !== null,
          'valid response': (r) => r.success === true,
          'all transactions processed': (r) => r.transactionsProcessed === largeBlock.transactions.length
        });
        break;
        
      case 'multi_endpoint':
        // Test with multiple RPC endpoints
        if (!isMockMode) {
          response = blocksMonitor.compareEndpointResults(chain.chainId, chain.endpoints);
        } else {
          // Mock mode simulation
          sleep(0.2); // Simulate processing time
          response = {
            success: true,
            endpointComparison: chain.endpoints.reduce((acc, endpoint, i) => {
              acc[endpoint] = { 
                url: endpoint,
                status: Math.random() > 0.1 ? 'active' : 'error',
                latency: randomIntBetween(50, 500),
                blockHeight: 1000000 + randomIntBetween(0, 5),
                lastSyncTime: Date.now() - randomIntBetween(1000, 10000),
              };
              return acc;
            }, {})
          };
        }
        
        check(response, {
          'request successful': (r) => r !== null,
          'valid response': (r) => r.success === true,
          'endpoint comparison data present': (r) => r.endpointComparison && Object.keys(r.endpointComparison).length > 0
        });
        break;
        
      default:
        // Default to single block processing
        return testBlocksBackendProcess(chain, 'single_block');
    }
  } catch (error) {
    console.error(`Error in direct module testing: ${error.message}`);
    response = { 
      success: false, 
      error: error.message 
    };
    processingSuccessRate.add(0);
  }
  
  // Add variable sleep to simulate real-world patterns
  sleep(randomIntBetween(1, 5) / 10);
  
  return {
    processType,
    chainId: chain.chainId,
    chainName: chain.name,
    success: response ? response.success : false,
    processingTime: new Date().getTime() - startTime,
    response
  };
}

// Primary test function
export default function() {
  const chain = utils.getRandomEnabledChain();
  
  // Choose a random process type to test
  const processTypes = ['single_block', 'block_time_analysis', 'tx_batch', 'multi_endpoint'];
  const processType = processTypes[Math.floor(Math.random() * processTypes.length)];
  
  group(`Blocks Backend - ${processType}`, function() {
    const response = testBlocksBackendProcess(chain, processType);
    
    console.log(`Blocks processing: ${processType}, success: ${response.success}, time: ${response.processingTime}ms`);
  });
  
  // Add variable sleep to simulate real-world patterns
  sleep(randomIntBetween(1, 5) / 10);
}
