/**
 * Consensus Backend Processing Stress Test (True Direct Module Testing)
 *
 * This script tests the actual ConsensusMonitor service under high load
 * by directly importing and using the actual module code.
 *
 * Focus areas:
 * - Validator set processing
 * - Epoch transition handling
 * - Miner performance analysis
 * - Reward calculation and distribution tracking
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
import { ConsensusMonitor } from '../../../src/monitoring/consensus/consensus.monitor';
import { EpochMonitor } from '../../../src/monitoring/consensus/epoch/epoch.monitor';
import { MinerMonitor } from '../../../src/monitoring/consensus/miner/miner.monitor';
import { ConfigService } from '../../../src/config/config.service';
import { LoggerService } from '../../../src/logger/logger.service';
import { Web3Service } from '../../../src/blockchain/web3.service';

// Custom metrics
const validatorSetProcessingTime = new Trend('validator_set_processing_time');
const epochTransitionTime = new Trend('epoch_transition_time');
const minerAnalysisTime = new Trend('miner_analysis_time');
const rewardProcessingTime = new Trend('reward_processing_time');
const validatorThroughput = new Counter('validator_throughput');
const epochProcessedCount = new Counter('epoch_processed_count');
const minerProcessedCount = new Counter('miner_processed_count');
const rewardDistributionCount = new Counter('reward_distribution_count');
const consensusCallSuccessRate = new Rate('consensus_call_success_rate');
const validatorUpdateSuccessRate = new Rate('validator_update_success_rate');
const epochTransitionSuccessRate = new Rate('epoch_transition_success_rate');
const performanceAnalysisSuccessRate = new Rate('performance_analysis_success_rate');
const rewardAnalysisSuccessRate = new Rate('reward_analysis_success_rate');

// Test configuration
export const options = {
  stages: STAGES.STANDARD,
  thresholds: {
    'validator_set_processing_time': ['p(95)<3000'],  // 95% of validator set processing under 3s
    'epoch_transition_time': ['p(95)<2000'],          // 95% of epoch transitions under 2s
    'miner_analysis_time': ['p(95)<5000'],            // 95% of miner analysis under 5s
    'reward_processing_time': ['p(95)<4000'],         // 95% of reward processing under 4s
    'consensus_call_success_rate': ['rate>0.95'],     // 95% overall success rate
    'validator_update_success_rate': ['rate>0.95'],   // 95% validator update success rate
    'epoch_transition_success_rate': ['rate>0.95'],   // 95% epoch transition success rate
    'performance_analysis_success_rate': ['rate>0.95'], // 95% miner analysis success rate
    'reward_analysis_success_rate': ['rate>0.95'],    // 95% reward analysis success rate
  },
};

// Helper to generate validator data
function generateValidator(index, status = 'active') {
  return {
    address: '0x' + randomIntBetween(1, 999999).toString(16).padStart(40, '0'),
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

// Generate a set of validators
function generateValidatorSet(size = 100) {
  const validators = [];
  const statuses = ['active', 'active', 'active', 'active', 'banned', 'pending', 'inactive']; // Weighted distribution
  
  for (let i = 0; i < size; i++) {
    const status = statuses[Math.floor(Math.random() * statuses.length)];
    validators.push(generateValidator(i, status));
  }
  
  return validators;
}

// Generate epoch data
function generateEpochData(epoch, validatorCount = 100) {
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
 * Helper to perform true direct module testing of consensus backend processing
 * @param {object} chain - Chain configuration
 * @param {string} processType - Type of process to test
 * @returns {object} Test result with response and metadata
 */
function testConsensusBackendProcess(chain, processType) {
  const startTime = new Date().getTime();
  let response = { success: false };
  
  // Create necessary services for the ConsensusMonitor
  const configService = new ConfigService();
  const loggerService = new LoggerService(configService);
  const web3Service = new Web3Service(configService, loggerService);
  
  // Initialize the actual monitor modules
  const consensusMonitor = new ConsensusMonitor(configService, loggerService, web3Service);
  const epochMonitor = new EpochMonitor(configService, loggerService, web3Service);
  const minerMonitor = new MinerMonitor(configService, loggerService, web3Service);
  
  // If in mock mode, don't try to use the actual module
  const isMockMode = __ENV.MOCK_MODE === 'true' || __ENV.MOCK_MODE === true;
  
  try {
    switch (processType) {
      case 'validator_set':
        // Process validator set
        const validatorCount = randomIntBetween(50, 200);
        
        if (!isMockMode) {
          // Direct call to the actual ConsensusMonitor module
          response = consensusMonitor.processValidatorSet(chain.chainId);
        } else {
          // Mock mode simulation
          sleep(0.2); // Simulate processing time
          
          // Generate mock validator data
          const validators = generateValidatorSet(validatorCount);
          
          response = {
            success: true,
            validators: validators,
            activeValidators: validators.filter(v => v.status === 'active').length,
            inactiveValidators: validators.filter(v => v.status !== 'active').length,
            processingTime: randomIntBetween(100, 500)
          };
        }
        
        validatorSetProcessingTime.add(new Date().getTime() - startTime);
        validatorThroughput.add(validatorCount);
        validatorUpdateSuccessRate.add(response.success ? 1 : 0);
        
        check(response, {
          'validator set processing successful': (r) => r.success === true,
          'validators processed': (r) => r.validators && r.validators.length > 0
        });
        break;
        
      case 'epoch_transition':
        // Process epoch transition
        const epochNumber = randomIntBetween(1000, 2000);
        
        if (!isMockMode) {
          // Direct call to the actual EpochMonitor module
          response = epochMonitor.processEpochTransition(chain.chainId, epochNumber);
        } else {
          // Mock mode simulation
          sleep(0.3); // Simulate processing time
          
          const epochData = generateEpochData(epochNumber);
          
          response = {
            success: true,
            epoch: epochNumber,
            epochData: epochData,
            validatorChanges: {
              added: randomIntBetween(0, 5),
              removed: randomIntBetween(0, 5),
              updated: randomIntBetween(1, 20)
            },
            processingTime: randomIntBetween(200, 800)
          };
        }
        
        epochTransitionTime.add(new Date().getTime() - startTime);
        epochProcessedCount.add(1);
        epochTransitionSuccessRate.add(response.success ? 1 : 0);
        
        check(response, {
          'epoch transition processing successful': (r) => r.success === true,
          'epoch processed': (r) => r.epoch !== undefined
        });
        break;
        
      case 'miner_analysis':
        // Analyze miner performance
        const timeFrame = ['1h', '24h', '7d'][Math.floor(Math.random() * 3)];
        
        if (!isMockMode) {
          // Direct call to the actual MinerMonitor module
          response = minerMonitor.analyzeMinerPerformance(chain.chainId, timeFrame);
        } else {
          // Mock mode simulation
          sleep(0.25); // Simulate processing time
          
          const minerCount = randomIntBetween(10, 50);
          
          // Generate mock miner data
          const miners = Array(minerCount).fill().map((_, i) => ({
            address: '0x' + randomIntBetween(100000, 999999).toString(16).padStart(40, '0'),
            blocksProduced: randomIntBetween(1, 100),
            missedBlocks: randomIntBetween(0, 10),
            performance: randomIntBetween(90, 100),
            rewards: randomIntBetween(1000, 10000)
          }));
          
          response = {
            success: true,
            timeFrame,
            miners: miners,
            totalBlocksProduced: miners.reduce((sum, m) => sum + m.blocksProduced, 0),
            averagePerformance: miners.reduce((sum, m) => sum + m.performance, 0) / miners.length,
            processingTime: randomIntBetween(150, 600)
          };
        }
        
        minerAnalysisTime.add(new Date().getTime() - startTime);
        minerProcessedCount.add(1);
        performanceAnalysisSuccessRate.add(response.success ? 1 : 0);
        
        check(response, {
          'miner analysis processing successful': (r) => r.success === true,
          'miners analyzed': (r) => r.miners && r.miners.length > 0
        });
        break;
        
      case 'reward_processing':
        // Process reward distribution
        const rewardEpoch = randomIntBetween(1000, 2000);
        
        if (!isMockMode) {
          // Direct call to the actual ConsensusMonitor module
          response = consensusMonitor.processRewardDistribution(chain.chainId, rewardEpoch);
        } else {
          // Mock mode simulation
          sleep(0.4); // Simulate processing time
          
          const totalRewards = randomIntBetween(10000, 100000);
          const validatorRewards = Math.floor(totalRewards * 0.8);
          const delegatorRewards = totalRewards - validatorRewards;
          
          response = {
            success: true,
            epoch: rewardEpoch,
            totalRewards,
            distribution: {
              validators: validatorRewards,
              delegators: delegatorRewards
            },
            processingTime: randomIntBetween(300, 1000)
          };
        }
        
        rewardProcessingTime.add(new Date().getTime() - startTime);
        rewardDistributionCount.add(1);
        rewardAnalysisSuccessRate.add(response.success ? 1 : 0);
        
        check(response, {
          'reward processing successful': (r) => r.success === true,
          'rewards processed': (r) => r.totalRewards !== undefined
        });
        break;
    }
  } catch (error) {
    console.error(`Error in consensus backend processing (${processType}): ${error.message}`);
    response.error = error.message;
  }
  
  // Record overall success rate
  consensusCallSuccessRate.add(response.success ? 1 : 0);
  
  return response;
}

// Primary test function
export default function() {
  const chain = utils.getRandomEnabledChain();
  
  // Choose a random process type to test
  const processTypes = ['validator_set', 'epoch_transition', 'miner_analysis', 'reward_processing'];
  const processType = processTypes[Math.floor(Math.random() * processTypes.length)];
  
  group(`Consensus Backend - ${chain.name} - ${processType}`, function() {
    // Call the direct module testing function
    const response = testConsensusBackendProcess(chain, processType);
    
    // Log basic information about the process
    console.log(`Processed ${processType} for ${chain.name} (${chain.chainId}): ${response.success ? 'SUCCESS' : 'FAILED'}`);
    
    // Additional check for common response properties across all process types
    check(response, {
      'operation succeeded': (r) => r.success === true,
      'processing time tracked': (r) => r.processingTime !== undefined
    });
  });
  
  // Add variable sleep to simulate real-world patterns and prevent overloading
  sleep(randomIntBetween(1, 5) / 10);
}
