/**
 * Stress Test Data Generators
 * 
 * Standardized generators for common test data types.
 * These functions reduce code duplication and ensure consistent test data patterns.
 */

import { randomIntBetween } from 'https://jslib.k6.io/k6-utils/1.2.0/index.js';
import { randomAddress, randomBlockNumber, randomItem, randomTxHash } from './test-utils.js';

/**
 * Generate block data with optional transaction count
 * @param {object} chain Chain object from config
 * @param {number} [blockNumber] Optional block number, random if not provided
 * @param {number} [txCount] Optional transaction count, random if not provided
 * @returns {object} Block data
 */
export function generateBlock(chain, blockNumber, txCount) {
  blockNumber = blockNumber || randomBlockNumber();
  txCount = txCount || randomIntBetween(5, 50);
  
  return {
    chainId: chain.chainId,
    network: chain.name,
    number: blockNumber,
    hash: '0x' + blockNumber.toString(16).padStart(64, '0'),
    parentHash: '0x' + (blockNumber - 1).toString(16).padStart(64, '0'),
    timestamp: Math.floor(Date.now() / 1000) - randomIntBetween(0, 600),
    miner: randomAddress(),
    difficulty: '0x' + randomIntBetween(1, 100000).toString(16),
    size: randomIntBetween(1000, 100000),
    gasUsed: randomIntBetween(21000 * txCount, 8000000),
    gasLimit: 30000000,
    transactions: Array(txCount).fill(null).map((_, i) => ({
      hash: '0x' + (blockNumber.toString() + i.toString()).padStart(64, '0'),
      from: randomAddress(),
      to: randomAddress(),
      value: randomIntBetween(0, 10000000000).toString(),
      gas: randomIntBetween(21000, 1000000),
      gasPrice: randomIntBetween(1, 100) * 1e9,
      input: i % 10 === 0 ? '0x' + 'f'.repeat(1000) : '0x', // Some contract interactions
      status: Math.random() > 0.05 ? 1 : 0, // 5% failure rate
    }))
  };
}

/**
 * Generate a series of blocks with realistic timestamps
 * @param {object} chain Chain object from config
 * @param {number} [count] Number of blocks to generate
 * @param {number} [intervalVariance] Variance in block times (0.0-1.0)
 * @returns {Array} Array of block objects
 */
export function generateBlockSeries(chain, count = 10, intervalVariance = 0.3) {
  const series = [];
  let lastTimestamp = Math.floor(Date.now() / 1000) - (count * 15); // Starting ~15s per block ago
  
  for (let i = 0; i < count; i++) {
    const blockNumber = 1000000 + i;
    const txCount = randomIntBetween(0, 30);
    
    // Add some variance to block times
    const intervalSecs = 15 * (1 + (Math.random() * intervalVariance * 2 - intervalVariance));
    lastTimestamp += Math.floor(intervalSecs);
    
    const block = generateBlock(chain, blockNumber, txCount);
    block.timestamp = lastTimestamp;
    series.push(block);
  }
  
  return series;
}

/**
 * Generate transaction data
 * @param {object} chain Chain object from config
 * @param {string} [type] Transaction type: 'standard', 'contract_call', 'contract_deploy', 'token_transfer'
 * @param {number} [blockNumber] Block number for the transaction
 * @returns {object} Transaction data
 */
export function generateTransaction(chain, type = 'standard', blockNumber) {
  const hash = randomTxHash();
  blockNumber = blockNumber || randomBlockNumber();
  
  const tx = {
    hash,
    chainId: chain.chainId,
    network: chain.name,
    blockNumber,
    transactionIndex: randomIntBetween(0, 100),
    from: randomAddress(),
    to: randomAddress(),
    value: randomIntBetween(0, 10000000000).toString(),
    gas: randomIntBetween(21000, 1000000),
    gasPrice: randomIntBetween(1, 100) * 1e9,
    nonce: randomIntBetween(0, 10000),
    status: Math.random() > 0.05 ? 1 : 0, // 5% failure rate
    timestamp: Math.floor(Date.now() / 1000) - randomIntBetween(0, 600),
  };
  
  // Customize based on transaction type
  switch (type) {
    case 'contract_call':
      tx.input = '0x' + 'a9059cbb'.padEnd(10, '0') + randomIntBetween(1, 999999).toString(16).padStart(64, '0');
      tx.gas = randomIntBetween(50000, 300000);
      break;
      
    case 'contract_deploy':
      tx.to = null;
      tx.input = '0x60806040' + 'f'.repeat(randomIntBetween(500, 2000));
      tx.gas = randomIntBetween(500000, 8000000);
      break;
      
    case 'token_transfer':
      tx.to = randomAddress(); // Token contract
      tx.input = '0xa9059cbb000000000000000000000000' + 
                randomIntBetween(1, 999999).toString(16).padStart(40, '0') +
                '0000000000000000000000000000000000000000000000000de0b6b3a7640000';
      tx.gas = randomIntBetween(50000, 150000);
      break;
      
    default: // standard
      tx.input = '0x';
      tx.gas = 21000;
  }
  
  return tx;
}

/**
 * Generate a batch of transactions
 * @param {object} chain Chain object from config
 * @param {number} [count] Number of transactions to generate
 * @param {boolean} [mixedTypes] Whether to include various tx types
 * @returns {Array} Array of transaction objects
 */
export function generateTransactionBatch(chain, count = 20, mixedTypes = true) {
  const types = ['standard', 'contract_call', 'contract_deploy', 'token_transfer'];
  const transactions = [];
  
  for (let i = 0; i < count; i++) {
    const type = mixedTypes 
      ? types[Math.floor(Math.random() * types.length)]
      : types[Math.floor(i / (count / types.length))];
    
    transactions.push(generateTransaction(chain, type));
  }
  
  return transactions;
}

/**
 * Generate validator data
 * @param {number} index Validator index
 * @param {string} [status] Validator status
 * @returns {object} Validator data
 */
export function generateValidator(index, status = 'active') {
  return {
    address: randomAddress(),
    index,
    status,
    stakedAmount: randomIntBetween(10000, 100000) * 1e18,
    blocksProduced: randomIntBetween(0, 1000),
    lastActiveEpoch: randomIntBetween(1000, 2000),
    rewards: randomIntBetween(0, 10000) * 1e18,
    uptime: Math.random() * 0.2 + 0.8, // 80-100% uptime
    penalties: randomIntBetween(0, 10),
  };
}

/**
 * Generate a set of validators
 * @param {number} [size] Number of validators to generate
 * @returns {Array} Array of validator objects
 */
export function generateValidatorSet(size = 100) {
  const validators = [];
  const statuses = ['active', 'active', 'active', 'active', 'banned', 'pending', 'inactive']; // Weighted distribution
  
  for (let i = 0; i < size; i++) {
    const status = randomItem(statuses);
    validators.push(generateValidator(i, status));
  }
  
  return validators;
}

/**
 * Generate epoch data
 * @param {number} epoch Epoch number
 * @param {number} [validatorCount] Number of validators
 * @returns {object} Epoch data
 */
export function generateEpochData(epoch, validatorCount = 100) {
  return {
    epoch,
    startBlock: epoch * 10000,
    endBlock: (epoch + 1) * 10000 - 1,
    validatorCount,
    activeValidators: validatorCount - randomIntBetween(0, 20),
    totalStake: validatorCount * (randomIntBetween(10000, 100000) * 1e18),
    blocksMissed: randomIntBetween(0, validatorCount * 5),
    averageBlockTime: randomIntBetween(2, 10),
    rewards: randomIntBetween(validatorCount * 100, validatorCount * 1000) * 1e18,
    penalties: randomIntBetween(0, validatorCount) * 1e18,
  };
}

/**
 * Generate alert data
 * @param {object} chain Chain object from config
 * @param {string} [type] Alert type
 * @param {string} [severity] Alert severity
 * @returns {object} Alert data
 */
export function generateAlert(chain, type, severity = 'warning') {
  const alertTypes = [
    'endpoint_down', 
    'block_time_high', 
    'transaction_failure', 
    'consensus_issue',
    'gas_price_spike',
    'sync_problem',
    'validator_inactive'
  ];
  
  const alertType = type || randomItem(alertTypes);
  const severities = ['info', 'warning', 'error', 'critical'];
  const alertSeverity = severity || randomItem(severities);
  
  const alert = {
    chainId: chain.chainId,
    network: chain.name,
    type: alertType,
    severity: alertSeverity,
    timestamp: new Date().toISOString(),
    message: `Test ${alertType} alert for ${chain.name}`,
    source: randomItem(['rpc_monitor', 'block_monitor', 'tx_monitor', 'consensus_monitor']),
    data: {}
  };
  
  // Add type-specific data
  switch (alertType) {
    case 'endpoint_down':
      alert.data = {
        endpoint: `https://rpc${randomIntBetween(1,5)}.${chain.name.toLowerCase()}.network`,
        downtime: randomIntBetween(1, 60),
        lastResponse: new Date(Date.now() - randomIntBetween(60, 3600) * 1000).toISOString()
      };
      break;
      
    case 'block_time_high':
      alert.data = {
        averageTime: randomIntBetween(15, 60),
        threshold: 15,
        lastBlock: randomBlockNumber(),
        timeframe: '15m'
      };
      break;
      
    case 'transaction_failure':
      alert.data = {
        txHash: randomTxHash(),
        reason: randomItem(['out_of_gas', 'revert', 'contract_error']),
        blockNumber: randomBlockNumber()
      };
      break;
      
    case 'consensus_issue':
      alert.data = {
        validatorsAffected: randomIntBetween(1, 20),
        totalValidators: randomIntBetween(50, 150),
        epoch: randomIntBetween(1000, 2000),
        missedBlocks: randomIntBetween(1, 50)
      };
      break;
      
    default:
      alert.data = {
        value: randomIntBetween(1, 100),
        threshold: randomIntBetween(50, 150),
        duration: `${randomIntBetween(1, 60)}m`
      };
  }
  
  return alert;
}

/**
 * Generate metrics data for InfluxDB
 * @param {string} type Metric type
 * @param {object} chain Chain object from config
 * @returns {object} Metrics data point
 */
export function generateMetricsPayload(type, chain) {
  const timestamp = new Date().toISOString();
  const tags = {
    chainId: chain.chainId,
    network: chain.name
  };
  
  let fields = {};
  
  switch (type) {
    case 'block':
      fields = {
        blockHeight: randomBlockNumber(),
        blockTime: randomIntBetween(2, 15),
        transactionCount: randomIntBetween(0, 100),
        size: randomIntBetween(1000, 100000)
      };
      break;
    case 'transaction':
      fields = {
        count: randomIntBetween(1, 100),
        gasUsed: randomIntBetween(21000, 10000000),
        successRate: Math.random(),
        averageConfirmationTime: randomIntBetween(2, 30)
      };
      break;
    case 'rpc':
      fields = {
        latency: randomIntBetween(50, 2000),
        successRate: Math.random(),
        errorCount: randomIntBetween(0, 10),
        requestCount: randomIntBetween(10, 1000)
      };
      break;
    case 'consensus':
      fields = {
        validators: randomIntBetween(50, 150),
        activeValidators: randomIntBetween(40, 150),
        blocksMissed: randomIntBetween(0, 20),
        rewardDistribution: randomIntBetween(1000, 10000)
      };
      break;
    default:
      fields = { value: Math.random() * 100 };
  }
  
  return {
    measurement: `xdc_${type}_metrics`,
    tags,
    timestamp,
    fields
  };
}

/**
 * Generate a batch of metrics data
 * @param {object} chain Chain object from config
 * @param {number} [batchSize] Number of metric points to generate
 * @returns {Array} Array of metric points
 */
export function generateMetricsBatch(chain, batchSize = 10) {
  const metricTypes = ['block', 'transaction', 'rpc', 'consensus'];
  const batch = [];
  
  for (let i = 0; i < batchSize; i++) {
    const type = randomItem(metricTypes);
    batch.push(generateMetricsPayload(type, chain));
  }
  
  return batch;
}

/**
 * Generate a blockchain event for simulation
 * @param {object} chain Chain object from config
 * @returns {object} Event data with type and details
 */
export function generateBlockchainEvent(chain) {
  const eventTypes = ['new_block', 'large_transaction_batch', 'contract_interaction', 'consensus_update'];
  const eventType = randomItem(eventTypes);
  
  const blockNumber = randomBlockNumber();
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
          hash: randomTxHash(),
          from: randomAddress(),
          to: randomAddress(),
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
        contractAddress: randomAddress(),
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
