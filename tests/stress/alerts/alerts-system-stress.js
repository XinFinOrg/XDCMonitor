/**
 * Alerts System Stress Test
 * 
 * This script tests the alerts system under high load conditions.
 * It simulates alert storms and applies increasing load to test
 * the system's ability to handle, deduplicate, and deliver alerts.
 * 
 * This test supports multiple chains (configured in config.js).
 * Enable/disable chains by toggling their 'enabled' flag in the CHAINS array.
 */

import { check, sleep } from 'k6';
import http from 'k6/http';
import { Counter, Rate, Trend } from 'k6/metrics';
import { BASE_URL, STAGES, THRESHOLDS, utils } from './config.js';

// Custom metrics
const alertGenerationTime = new Trend('alert_generation_time');
const alertDeliveryRate = new Rate('alert_delivery_success');
const alertGenerationRate = new Rate('alert_generation_success');
const alertChecks = new Counter('alert_triggers');
const alertErrors = new Counter('alert_errors');

// Test configuration
export const options = {
  stages: STAGES.STANDARD,
  thresholds: {
    ...THRESHOLDS.HEAVY,
    'alert_generation_success': ['rate>0.9'],  // At least 90% of alert generations should succeed
    'alert_delivery_success': ['rate>0.85'],   // At least 85% of alerts should be delivered
    'alert_generation_time': ['p(95)<5000'],   // 95% of alert generations within 5s
  }
};

// Check if we have any enabled chains
const enabledChains = utils.getEnabledChains();
if (enabledChains.length === 0) {
  throw new Error('No chains enabled for testing in config.js. Please enable at least one chain.');
}

// Alert types to test
const ALERT_TYPES = [
  { name: 'block-time', component: 'blockchain', severity: 'warning', weight: 0.25 },
  { name: 'tx-errors', component: 'transactions', severity: 'warning', weight: 0.2 },
  { name: 'tx-volume', component: 'transactions', severity: 'info', weight: 0.15 },
  { name: 'rpc-time', component: 'rpc', severity: 'critical', weight: 0.25 },
  { name: 'test-tx-failures', component: 'transactions', severity: 'warning', weight: 0.15 }
];

// Select alert type based on weighted probability
function selectAlertType() {
  const rand = Math.random();
  let cumulativeWeight = 0;
  
  for (const type of ALERT_TYPES) {
    cumulativeWeight += type.weight;
    if (rand <= cumulativeWeight) {
      return type;
    }
  }
  
  return ALERT_TYPES[0]; // Default to first type
}

// Main test function
export default function() {
  // Select a random enabled chain
  const chain = utils.getRandomEnabledChain();
  const chainId = chain.chainId;
  
  // Select alert type to trigger
  const alertType = selectAlertType();
  
  // Construct the endpoint URL for triggering a test alert
  const url = `${BASE_URL}/api/testing/trigger-alert/${alertType.name}?chainId=${chainId}`;
  
  // Record start time
  const startTime = new Date().getTime();
  
  // Make the request to trigger the alert
  const response = http.post(url, JSON.stringify({
    component: alertType.component,
    severity: alertType.severity,
    chainId: chainId,
    network: chain.name,
    simulateDelivery: true
  }), {
    headers: { 'Content-Type': 'application/json' },
    tags: {
      chain: chain.name,
      chainId: chainId,
      alertType: alertType.name,
      severity: alertType.severity
    }
  });
  
  // Record generation time
  const genTime = new Date().getTime() - startTime;
  alertGenerationTime.add(genTime, { 
    chainId: chainId, 
    network: chain.name, 
    type: alertType.name,
    severity: alertType.severity
  });
  
  // Increment alert check counter
  alertChecks.add(1, { 
    chainId: chainId, 
    network: chain.name, 
    type: alertType.name,
    severity: alertType.severity
  });
  
  // Check alert generation response
  const genSuccess = check(response, {
    'status is 200': (r) => r.status === 200,
    'alert triggered': (r) => {
      try {
        const body = JSON.parse(r.body);
        return body.success === true;
      } catch (e) {
        return false;
      }
    }
  }, { 
    chainId: chainId, 
    network: chain.name, 
    type: alertType.name,
    severity: alertType.severity
  });
  
  // Record alert generation success/failure
  alertGenerationRate.add(genSuccess ? 1 : 0, { 
    chainId: chainId, 
    network: chain.name, 
    type: alertType.name,
    severity: alertType.severity
  });
  
  // Check the alert delivery status if generation was successful
  if (genSuccess) {
    try {
      const body = JSON.parse(response.body);
      
      // Record alert delivery success (note: in a real system, this might be a separate API call)
      const deliverySuccess = body.delivered === true;
      alertDeliveryRate.add(deliverySuccess ? 1 : 0, { 
        chainId: chainId, 
        network: chain.name, 
        type: alertType.name,
        severity: alertType.severity
      });
      
      if (!deliverySuccess) {
        console.log(`Alert delivery failed for ${alertType.name} on chain ${chain.name} (${chainId})`);
      }
    } catch (e) {
      alertErrors.add(1, { 
        chainId: chainId, 
        network: chain.name, 
        type: alertType.name,
        error: 'parse_error'
      });
      console.log(`Failed to parse alert response: ${e.message}`);
    }
  } else {
    alertErrors.add(1, { 
      chainId: chainId, 
      network: chain.name, 
      type: alertType.name,
      error: 'generation_failed'
    });
    console.log(`Failed to generate alert ${alertType.name} on chain ${chain.name} (${chainId}): ${response.status} ${response.body.substring(0, 100)}...`);
  }
  
  // Simulate processing time and random sleep between requests
  sleep(utils.randomSleep(0.5, 2));
}

/**
 * To run this test:
 * 1. Install k6: https://k6.io/docs/getting-started/installation/
 * 2. Start your XDC Monitor application
 * 3. Run: k6 run alerts-system-stress.js
 * 
 * This test will:
 * - Test alert generation and delivery for all enabled chains
 * - Simulate different alert types with varying severity levels
 * - Track alert generation and delivery success rates
 * - Measure alert processing times under load
 * 
 * For more advanced testing:
 * - Adjust alert type weights to focus on specific alert scenarios
 * - Enable additional chains by toggling flags in config.js
 * - Modify the stages to create more intense alert storms
 */
