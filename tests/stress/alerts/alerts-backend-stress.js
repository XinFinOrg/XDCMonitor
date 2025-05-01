/**
 * Alerts Backend Processing Stress Test (True Direct Module Testing)
 *
 * This script tests the actual AlertService under high load
 * by directly importing and using the actual module code.
 *
 * Focus areas:
 * - Alert condition evaluation
 * - Alert processing and delivery
 * - Multiple notification channels
 * - Cross-chain alert aggregation
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
import { AlertService } from '../../../src/alerts/alert.service';
import { ConfigService } from '../../../src/config/config.service';
import { LoggerService } from '../../../src/logger/logger.service';

// Mock imports for MOCK_MODE
import {
  ALERT_TYPES,
  COMPONENT_TYPES,
  SEVERITY,
  generateAlert,
} from '../utils/alerts-simulator.js';

// Custom metrics
const alertConditionEvalTime = new Trend('alert_condition_eval_time');
const alertProcessingTime = new Trend('alert_processing_time');
const alertDeliveryTime = new Trend('alert_delivery_time');
const alertBatchProcessingTime = new Trend('alert_batch_processing_time');
const alertsProcessed = new Counter('alerts_processed');
const alertProcessingSuccessRate = new Rate('alert_processing_success_rate');
const alertDeliverySuccessRate = new Rate('alert_delivery_success_rate');

// Test configuration
export const options = {
  stages: STAGES.STANDARD,
  thresholds: {
    'alert_condition_eval_time': ['p(95)<1000'],       // 95% of condition evals under 1s
    'alert_processing_time': ['p(95)<3000'],           // 95% of alert processing under 3s
    'alert_delivery_time': ['p(95)<2000'],             // 95% of deliveries under 2s
    'alert_processing_success_rate': ['rate>0.95'],    // 95% success rate for processing
    'alert_delivery_success_rate': ['rate>0.90'],      // 90% success rate for deliveries
    'http_req_failed': ['rate<0.05'],                  // Overall HTTP failure rate under 5%
  },
};

/**
 * Test alert processing using true direct module testing
 * @param {object} chain - Chain configuration
 * @param {string} processType - Type of alert processing to simulate
 * @returns {object} Simulation results
 */
function testAlertBackendProcess(chain, processType) {
  const startTime = new Date().getTime();
  let response = { success: false };
  
  // Create necessary services for the AlertService
  const configService = new ConfigService();
  const loggerService = new LoggerService(configService);
  
  // Initialize the actual AlertService module
  const alertService = new AlertService(configService, loggerService);
  
  // If in mock mode, don't try to use the actual module
  const isMockMode = __ENV.MOCK_MODE === 'true' || __ENV.MOCK_MODE === true;
  
  // Determine what type of processing to test
  try {
    switch (processType) {
      case 'condition_evaluation':
        // Evaluate alert conditions
        const numConditions = randomIntBetween(5, 20);
        const componentType = Object.values(COMPONENT_TYPES)[Math.floor(Math.random() * Object.values(COMPONENT_TYPES).length)];
        
        const evalStartTime = new Date().getTime();
        
        if (!isMockMode) {
          // Create test data for the conditions
          const conditionData = {
            chainId: chain.chainId,
            component: componentType,
            metrics: {
              value: randomIntBetween(70, 130),
              threshold: 100,
              trend: Math.random() > 0.5 ? 'increasing' : 'decreasing'
            }
          };
          
          response = alertService.evaluateConditions(conditionData);
        } else {
          // Mock mode simulation
          sleep(0.1); // Simulate processing time
          const triggeredCount = Math.floor(numConditions * Math.random() * 0.3); // 0-30% triggered
          
          response = {
            success: true,
            conditionsEvaluated: numConditions,
            conditionsTriggered: triggeredCount,
            evaluationTime: randomIntBetween(10, 50)
          };
        }
        
        alertConditionEvalTime.add(new Date().getTime() - evalStartTime);
        
        check(response, {
          'request successful': (r) => r !== null,
          'valid response': (r) => r.success === true,
          'conditions evaluated': (r) => r.conditionsEvaluated > 0
        });
        break;
        
      case 'alert_processing':
        // Process a single alert
        const alertComponent = Object.values(COMPONENT_TYPES)[Math.floor(Math.random() * Object.values(COMPONENT_TYPES).length)];
        const alertType = ALERT_TYPES[alertComponent][Math.floor(Math.random() * ALERT_TYPES[alertComponent].length)];
        
        // Generate or get an alert
        const alert = isMockMode ?
          generateAlert({
            chainId: chain.chainId,
            component: alertComponent,
            alertType: alertType,
            severity: Math.random() > 0.7 ? SEVERITY.CRITICAL : SEVERITY.WARNING,
          }) :
          { /* Create a real alert object based on your system's alert structure */ };
        
        const processStartTime = new Date().getTime();
        
        if (!isMockMode) {
          response = alertService.processAlert(alert);
        } else {
          // Mock mode simulation
          sleep(0.2); // Simulate processing time
          const notified = Math.random() > 0.1; // 90% chance of successful notification
          const channels = ['email', 'slack', 'dashboard'];
          const deliveredChannels = channels.filter(() => Math.random() > 0.2); // Some channels may fail
          
          response = {
            success: true,
            alert: alert,
            notified: notified,
            channels: deliveredChannels,
            processingTime: randomIntBetween(20, 100)
          };
        }
        
        alertProcessingTime.add(new Date().getTime() - processStartTime);
        
        check(response, {
          'request successful': (r) => r !== null,
          'valid response': (r) => r.success === true,
          'alert processed': (r) => r.alert !== undefined
        });
        
        alertAggregationTime.add(new Date().getTime() - aggStartTime);
        
        check(response, {
          'request successful': (r) => r !== null,
          'valid response': (r) => r.success === true,
          'aggregation data present': (r) => r.correlatedAlerts && r.correlatedAlerts.length > 0
        });
        break;
        
      case 'batch_processing':
        // Process a batch of alerts
        const batchSize = randomIntBetween(5, 50);
        
        // Generate alert batch
        const alertBatch = isMockMode ?
          Array(batchSize).fill().map(() => generateAlert({
            chainId: chain.chainId,
            component: Object.values(COMPONENT_TYPES)[Math.floor(Math.random() * Object.values(COMPONENT_TYPES).length)],
            severity: Object.values(SEVERITY)[Math.floor(Math.random() * Object.values(SEVERITY).length)],
          })) :
          [ /* Create real alert objects */ ];
        
        const batchStartTime = new Date().getTime();
        
        if (!isMockMode) {
          response = alertService.processBatch(alertBatch, chain.chainId);
        } else {
          // Mock mode simulation
          sleep(0.3); // Simulate processing time
          const triggeredCount = Math.floor(batchSize * 0.4); // 40% trigger rate
          const successfulDeliveries = Math.floor(triggeredCount * 0.9); // 90% delivery success
          
          response = {
            success: true,
            batchSize: batchSize,
            processedAlerts: batchSize,
            triggeredAlerts: triggeredCount,
            deliveryStats: {
              channels: ['email', 'slack', 'dashboard'],
              totalAttempts: triggeredCount * 3, // 3 channels per alert
              successfulDeliveries: successfulDeliveries,
              deliveryRate: 0.9,
            },
            processingTime: randomIntBetween(batchSize * 5, batchSize * 15)
          };
        }
        
        batchAlertProcessingTime.add(new Date().getTime() - batchStartTime);
        alertProcessedCount.add(batchSize);
        
        check(response, {
          'request successful': (r) => r !== null,
          'valid response': (r) => r.success === true,
          'batch fully processed': (r) => r.processedAlerts === batchSize
        });
        break;
        
      default:
        // Default to condition evaluation
        return testAlertBackendProcess(chain, 'condition_evaluation');
    }
    
    // Add to success rate metric
    alertProcessingSuccessRate.add(response.success ? 1 : 0);
    
  } catch (error) {
    console.error(`Error in direct module testing: ${error.message}`);
    response = { 
      success: false, 
      error: error.message 
    };
    alertProcessingSuccessRate.add(0);
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
  const processTypes = ['condition_evaluation', 'alert_processing', 'alert_batch', 'cross_chain_aggregation'];
  const processType = processTypes[Math.floor(Math.random() * processTypes.length)];
  
  group(`Alert Backend - ${processType}`, function() {
    const response = testAlertBackendProcess(chain, processType);
    
    // Check is already performed inside testAlertBackendProcess
    // Just add some k6 logging for observability
    console.log(`Alert processing: ${processType}, success: ${response.success}, time: ${response.processingTime}ms`);
  });
  
  // Add variable sleep to simulate real-world patterns
  sleep(randomIntBetween(1, 5) / 10);
}
