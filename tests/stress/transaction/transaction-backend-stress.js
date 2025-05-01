/**
 * Transaction Backend Processing Stress Test (True Direct Module Testing)
 *
 * This script tests the actual TransactionMonitor service under high load
 * by directly importing and using the actual module code.
 *
 * Focus areas:
 * - Transaction batch processing
 * - Transaction verification and status tracking
 * - Transaction rate calculation with sliding windows
 * - Smart contract interactions
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
import { TransactionMonitor } from '../../../src/monitoring/transaction/transaction.monitor';
import { ConfigService } from '../../../src/config/config.service';
import { LoggerService } from '../../../src/logger/logger.service';
import { Web3Service } from '../../../src/blockchain/web3.service';

// Mock imports for MOCK_MODE
import { generateTransaction } from '../utils/transaction-simulator.js';

// Custom metrics
const txProcessingTime = new Trend('tx_backend_processing_time');
const txVerificationTime = new Trend('tx_verification_time');
const txRateCalculationTime = new Trend('tx_rate_calculation_time');
const contractAnalysisTime = new Trend('contract_analysis_time');
const txProcessingThroughput = new Counter('tx_processing_throughput');
const processingSuccessRate = new Rate('tx_processing_success_rate');

// Test configuration
export const options = {
  stages: STAGES.STANDARD,
  thresholds: {
    'tx_backend_processing_time': ['p(95)<3000'],    // 95% of tx processing under 3s
    'tx_verification_time': ['p(95)<2000'],          // 95% of verification under 2s
    'contract_analysis_time': ['p(95)<5000'],        // 95% of contract analysis under 5s
    'tx_processing_success_rate': ['rate>0.95'],     // 95% success rate
    'http_req_failed': ['rate<0.05'],                // Overall HTTP failure rate under 5%
  },
};

/**
 * Test transaction processing using true direct module testing
 * @param {object} chain - Chain configuration
 * @param {string} processType - Type of transaction processing to simulate
 * @returns {object} Simulation results
 */
function testTransactionBackendProcess(chain, processType) {
  const startTime = new Date().getTime();
  let response = { success: false };
  
  // Create necessary services for the TransactionMonitor
  const configService = new ConfigService();
  const loggerService = new LoggerService(configService);
  const web3Service = new Web3Service(configService, loggerService);
  
  // Initialize the actual TransactionMonitor module
  const transactionMonitor = new TransactionMonitor(
    configService,
    loggerService,
    web3Service
  );
  
  // If in mock mode, don't try to use the actual module
  const isMockMode = __ENV.MOCK_MODE === 'true' || __ENV.MOCK_MODE === true;
  
  // Determine what type of processing to test
  try {
    switch (processType) {
      case 'single_tx':
        // Get or generate a transaction
        const tx = isMockMode ? 
          generateTransaction({ chainId: chain.chainId }) : 
          web3Service.getTransaction(chain.chainId, null); // Get latest transaction
        
        // Directly call the actual module function
        if (!isMockMode) {
          response = transactionMonitor.processTransaction(tx, chain.chainId);
          
          txProcessingTime.add(response.processingTime || 0);
          txProcessingThroughput.add(1);
          
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
            transaction: tx,
            status: 'confirmed',
            blockNumber: tx.blockNumber,
            processingTime: randomIntBetween(20, 100)
          };
          processingSuccessRate.add(1);
        }
        break;
        
      case 'tx_batch':
        // Process a batch of transactions
        const batchSize = randomIntBetween(10, 100);
        const txBatch = isMockMode ?
          Array(batchSize).fill().map(() => generateTransaction({ chainId: chain.chainId })) :
          web3Service.getTransactionBatch(chain.chainId, batchSize);
        
        const batchStartTime = new Date().getTime();
        
        if (!isMockMode) {
          response = transactionMonitor.processTransactionBatch(txBatch, chain.chainId);
        } else {
          // Mock mode simulation
          sleep(0.3); // Simulate processing time
          const failedCount = Math.floor(batchSize * 0.05); // 5% failure rate
          
          response = {
            success: true,
            batchSize: batchSize,
            processedTransactions: batchSize,
            failedTransactions: failedCount,
            averageProcessingTime: randomIntBetween(20, 50),
            totalProcessingTime: randomIntBetween(batchSize * 10, batchSize * 30)
          };
        }
        
        txBatchProcessingTime.add(new Date().getTime() - batchStartTime);
        txProcessingThroughput.add(batchSize);
        
        check(response, {
          'request successful': (r) => r !== null,
          'valid response': (r) => r.success === true,
          'batch fully processed': (r) => r.processedTransactions === batchSize
        });
        break;
        
      case 'contract_tx':
        // Process a contract interaction transaction
        const contractTx = isMockMode ?
          generateTransaction({ chainId: chain.chainId, type: 'contract_call' }) :
          web3Service.getContractTransaction(chain.chainId);
        
        if (!isMockMode) {
          response = transactionMonitor.processContractTransaction(contractTx, chain.chainId);
        } else {
          // Mock mode simulation
          sleep(0.2); // Simulate processing time
          response = {
            success: true,
            transaction: contractTx,
            contractAddress: '0x' + randomIntBetween(100000, 999999).toString(16).padStart(40, '0'),
            methodName: ['transfer', 'approve', 'mint', 'swap'][Math.floor(Math.random() * 4)],
            parameters: { to: '0x123...', value: '1000000000000000000' },
            status: Math.random() > 0.1 ? 'success' : 'failed',
            processingTime: randomIntBetween(30, 150)
          };
        }
        
        contractProcessingTime.add(response.processingTime || randomIntBetween(30, 150));
        txProcessingThroughput.add(1);
        
        check(response, {
          'request successful': (r) => r !== null,
          'valid response': (r) => r.success === true,
          'contract data present': (r) => r.contractAddress && r.methodName
        });
        break;
        
      case 'tx_rate_analysis':
        // Analyze transaction rates
        const timeWindows = ['1m', '10m', '1h', '24h'];
        const selectedWindow = timeWindows[Math.floor(Math.random() * timeWindows.length)];
        
        const analysisStartTime = new Date().getTime();
        
        if (!isMockMode) {
          response = transactionMonitor.analyzeTransactionRate(chain.chainId, selectedWindow);
        } else {
          // Mock mode simulation
          sleep(0.15); // Simulate processing time
          const txRate = randomIntBetween(10, 1000);
          
          response = {
            success: true,
            chainId: chain.chainId,
            timeWindow: selectedWindow,
            transactionRate: txRate,
            comparisonData: {
              previousTimeWindow: txRate * (Math.random() * 0.5 + 0.75), // 75-125% of current rate
              averageRate: txRate * (Math.random() * 0.3 + 0.85), // 85-115% of current rate
            }
          };
        }
        
        txRateAnalysisTime.add(new Date().getTime() - analysisStartTime);
        
        check(response, {
          'request successful': (r) => r !== null,
          'valid response': (r) => r.success === true,
          'rate analysis present': (r) => r.transactionRate && r.comparisonData
        });
        break;
        
      default:
        // Default to single transaction processing
        return testTransactionBackendProcess(chain, 'single_tx');
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
  const processTypes = ['single_tx', 'tx_batch', 'contract_tx', 'tx_rate_analysis'];
  const processType = processTypes[Math.floor(Math.random() * processTypes.length)];
  
  group(`Transaction Backend - ${processType}`, function() {
    const response = testTransactionBackendProcess(chain, processType);
    
    // Check is already performed inside testTransactionBackendProcess
    // Just add some k6 logging for observability
    console.log(`Transaction processing: ${processType}, success: ${response.success}, time: ${response.processingTime}ms`);
  });
  
  // Add variable sleep to simulate real-world patterns
  sleep(randomIntBetween(1, 5) / 10);
}
