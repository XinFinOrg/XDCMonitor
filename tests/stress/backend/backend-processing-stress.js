/**
 * Backend Processing Stress Test
 * 
 * This script tests the backend processing capacity of XDC Monitor's monitoring services
 * by simulating high frequency blockchain activity for blocks, transactions, and events.
 */

import { sleep, check } from 'k6';
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

// Custom metrics
const processingLatency = new Trend('backend_processing_latency');
const blockProcessingTime = new Trend('block_processing_time');
const txProcessingTime = new Trend('transaction_processing_time');
const processingErrorRate = new Rate('backend_processing_error_rate');
const processingSuccessRate = new Rate('backend_processing_success_rate');
const processingThroughput = new Counter('backend_processing_throughput');

// Simulation types
const SIMULATION_TYPES = {
  RAPID_BLOCKS: 'rapid_blocks',
  HIGH_TX_VOLUME: 'high_tx_volume',
  MIXED_ACTIVITY: 'mixed_activity',
  LARGE_CONTRACT_DEPLOY: 'large_contract_deploy'
};

// Configure the load profile
export const options = {
  stages: STAGES.STANDARD,
  thresholds: {
    'backend_processing_latency': ['p95<5000'],
    'backend_processing_error_rate': ['rate<0.05'],
    'backend_processing_success_rate': ['rate>0.95'],
    'http_req_failed': ['rate<0.01'],
    'http_req_duration': ['p95<5000'],
  },
};

// Helper function to generate simulated block data with varying transaction counts
function generateBlockData(chain, blockNumber, txCount) {
  return {
    chainId: chain.chainId,
    network: chain.name,
    blockNumber,
    timestamp: new Date().toISOString(),
    transactionCount: txCount,
    size: randomIntBetween(10000, 1000000),
    gasUsed: randomIntBetween(txCount * 21000, txCount * 100000),
    gasLimit: 30000000,
    difficulty: '0x1',
    totalDifficulty: '0x1',
    parentHash: '0x' + '1'.repeat(64),
    miner: '0x' + '2'.repeat(40),
    nonce: '0x' + randomIntBetween(1, 1000000).toString(16),
    extraData: '0x',
    stateRoot: '0x' + '3'.repeat(64),
    receiptsRoot: '0x' + '4'.repeat(64),
    sha3Uncles: '0x' + '5'.repeat(64),
    logsBloom: '0x' + '0'.repeat(512),
    mixHash: '0x' + '6'.repeat(64),
  };
}

// Generate transaction data for simulation
function generateTransactionData(chain, txIndex, blockNumber) {
  const txTypes = ['standard', 'contract_call', 'contract_deploy', 'token_transfer'];
  const txType = txTypes[Math.floor(Math.random() * txTypes.length)];
  
  return {
    chainId: chain.chainId,
    network: chain.name,
    blockNumber,
    transactionIndex: txIndex,
    hash: '0x' + txIndex.toString(16).padStart(64, '0'),
    from: '0x' + randomIntBetween(1, 999999).toString(16).padStart(40, '0'),
    to: txType === 'contract_deploy' ? null : '0x' + randomIntBetween(1, 999999).toString(16).padStart(40, '0'),
    value: randomIntBetween(0, 10000000000).toString(),
    gas: randomIntBetween(21000, 1000000),
    gasPrice: randomIntBetween(1, 100) * 1e9,
    input: txType === 'standard' ? '0x' : '0x' + 'f'.repeat(randomIntBetween(10, 1000) * 2),
    nonce: randomIntBetween(0, 1000),
    type: txType,
    status: Math.random() > 0.05 ? 1 : 0, // 5% failure rate
  };
}

// Primary test function
export default function() {
  const chain = utils.getRandomEnabledChain();
  // Determine simulation type for this iteration
  const simulationType = Object.values(SIMULATION_TYPES)[
    Math.floor(Math.random() * Object.values(SIMULATION_TYPES).length)
  ];
  
  let response;
  const startTime = new Date().getTime();
  
  switch (simulationType) {
    case SIMULATION_TYPES.RAPID_BLOCKS:
      // Simulate rapid block production
      const blockNumber = randomIntBetween(1000000, 9999999);
      const blockData = generateBlockData(chain, blockNumber, randomIntBetween(5, 30));
      
      response = http.post(
        `${BASE_URL}/api/testing/blocks/simulate-new-block`,
        JSON.stringify(blockData),
        {
          headers: { 'Content-Type': 'application/json' },
          tags: { chain: chain.name, type: 'block_processing' }
        }
      );
      
      blockProcessingTime.add(response.timings.duration);
      break;
      
    case SIMULATION_TYPES.HIGH_TX_VOLUME:
      // Simulate high transaction volume
      const txCount = randomIntBetween(50, 200);
      const txBatch = [];
      const txBlockNumber = randomIntBetween(1000000, 9999999);
      
      for (let i = 0; i < txCount; i++) {
        txBatch.push(generateTransactionData(chain, i, txBlockNumber));
      }
      
      response = http.post(
        `${BASE_URL}/api/testing/transactions/batch`,
        JSON.stringify({ transactions: txBatch }),
        {
          headers: { 'Content-Type': 'application/json' },
          tags: { chain: chain.name, type: 'transaction_processing' }
        }
      );
      
      txProcessingTime.add(response.timings.duration);
      processingThroughput.add(txCount);
      break;
      
    case SIMULATION_TYPES.MIXED_ACTIVITY:
      // Simulate mixed blockchain activity (blocks + transactions)
      const mixedBlockNumber = randomIntBetween(1000000, 9999999);
      const mixedTxCount = randomIntBetween(10, 100);
      const mixedBlockData = generateBlockData(chain, mixedBlockNumber, mixedTxCount);
      const mixedTxBatch = [];
      
      for (let i = 0; i < mixedTxCount; i++) {
        mixedTxBatch.push(generateTransactionData(chain, i, mixedBlockNumber));
      }
      
      response = http.post(
        `${BASE_URL}/api/testing/blocks/simulate-complete-block`,
        JSON.stringify({ 
          block: mixedBlockData, 
          transactions: mixedTxBatch 
        }),
        {
          headers: { 'Content-Type': 'application/json' },
          tags: { chain: chain.name, type: 'mixed_processing' }
        }
      );
      
      processingThroughput.add(mixedTxCount + 1); // Block + transactions
      break;
      
    case SIMULATION_TYPES.LARGE_CONTRACT_DEPLOY:
      // Simulate a large contract deployment
      const deployBlockNumber = randomIntBetween(1000000, 9999999);
      const contractData = generateTransactionData(chain, 0, deployBlockNumber);
      
      // Modify to make it a large contract
      contractData.type = 'contract_deploy';
      contractData.to = null;
      contractData.input = '0x' + 'f'.repeat(50000); // Very large input data
      contractData.gas = 8000000;
      
      response = http.post(
        `${BASE_URL}/api/testing/contracts/deploy`,
        JSON.stringify(contractData),
        {
          headers: { 'Content-Type': 'application/json' },
          tags: { chain: chain.name, type: 'contract_processing' }
        }
      );
      break;
  }
  
  const processingTime = new Date().getTime() - startTime;
  processingLatency.add(processingTime, { type: simulationType });
  
  const success = check(response, {
    'processing successful': (r) => r.status === 200 || r.status === 201
  });
  
  processingSuccessRate.add(success);
  processingErrorRate.add(!success);
  
  // Variable sleep to simulate real-world patterns
  sleep(randomIntBetween(0.1, 1) + (simulationType === SIMULATION_TYPES.LARGE_CONTRACT_DEPLOY ? 1 : 0));
}
