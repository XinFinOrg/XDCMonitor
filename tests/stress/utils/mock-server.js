/**
 * Mock Server for XDC Monitor Stress Testing
 * 
 * This module provides mock responses for all API endpoints used in stress tests.
 * It allows running the full test suite without a running XDC Monitor instance.
 */

import { randomIntBetween } from 'https://jslib.k6.io/k6-utils/1.2.0/index.js';

// Mock response generators for different API endpoints
const mockResponses = {
  // Event simulation endpoint
  'events/simulate': () => {
    const eventId = `evt_${Date.now()}_${Math.floor(Math.random() * 1000000)}`;
    return {
      status: 200,
      body: JSON.stringify({
        success: true,
        eventId: eventId,
        message: 'Event received and processing started'
      })
    };
  },
  
  // Metrics status endpoint
  'metrics/status': (params) => {
    // Extract eventId from query params if present
    const eventId = params?.eventId || '';
    return {
      status: 200,
      body: JSON.stringify({
        stored: true,
        metrics: {
          count: randomIntBetween(5, 20),
          timestamp: new Date().toISOString()
        },
        eventId: eventId
      })
    };
  },
  
  // Dashboard query endpoint
  'dashboard/query': (params) => {
    const queryType = params?.type || 'latest_blocks';
    const timeRange = params?.timeRange || '1h';
    const chainId = params?.chainId || 51;
    
    // Generate appropriate mock data based on query type
    let data = [];
    const dataPoints = randomIntBetween(10, 30);
    
    switch (queryType) {
      case 'latest_blocks':
        for (let i = 0; i < dataPoints; i++) {
          data.push({
            blockNumber: 1000000 + i,
            timestamp: new Date(Date.now() - i * 60000).toISOString(),
            transactionCount: randomIntBetween(5, 100),
            size: randomIntBetween(10000, 500000)
          });
        }
        break;
        
      case 'transaction_volume':
        for (let i = 0; i < dataPoints; i++) {
          data.push({
            timestamp: new Date(Date.now() - i * 300000).toISOString(),
            count: randomIntBetween(50, 500),
            volume: randomIntBetween(1000, 100000)
          });
        }
        break;
        
      case 'network_health':
        for (let i = 0; i < dataPoints; i++) {
          data.push({
            timestamp: new Date(Date.now() - i * 300000).toISOString(),
            rpcAvailability: randomIntBetween(95, 100) / 100,
            blockTime: randomIntBetween(2, 15),
            peerCount: randomIntBetween(10, 50)
          });
        }
        break;
        
      case 'validator_status':
        for (let i = 0; i < dataPoints; i++) {
          data.push({
            timestamp: new Date(Date.now() - i * 300000).toISOString(),
            activeValidators: randomIntBetween(40, 150),
            participation: randomIntBetween(90, 100) / 100
          });
        }
        break;
        
      case 'gas_usage':
        for (let i = 0; i < dataPoints; i++) {
          data.push({
            timestamp: new Date(Date.now() - i * 300000).toISOString(),
            avgGasPrice: randomIntBetween(1, 100),
            totalGasUsed: randomIntBetween(1000000, 10000000)
          });
        }
        break;
    }
    
    return {
      status: 200,
      body: JSON.stringify({
        success: true,
        data: data,
        meta: {
          queryType,
          timeRange,
          chainId: Number(chainId),
          dataPoints: data.length
        }
      })
    };
  }
};

/**
 * Generate a mock response for a given URL
 * @param {string} url The full URL
 * @param {object} requestBody Optional request body
 * @returns {object} Mock response with status and body
 */
export function getMockResponse(url, requestBody = null) {
  // Extract the endpoint path and query parameters using simple string operations
  // since k6 doesn't support the URL class
  const urlParts = url.split('?');
  const path = urlParts[0];
  const queryString = urlParts.length > 1 ? urlParts[1] : '';
  
  // Parse query parameters
  const params = {};
  if (queryString) {
    queryString.split('&').forEach(param => {
      const [key, value] = param.split('=');
      if (key && value) {
        params[key] = decodeURIComponent(value);
      }
    });
  }
  
  // Extract the endpoint name from the path
  const pathParts = path.split('/');
  const endpoint = pathParts[pathParts.length - 1] || pathParts[pathParts.length - 2];
  
  // Find the appropriate mock response generator
  for (const [mockEndpoint, generator] of Object.entries(mockResponses)) {
    if (path.includes(mockEndpoint)) {
      return generator(params, requestBody);
    }
  }
  
  // Default response if no specific mock is found
  return {
    status: 404,
    body: JSON.stringify({
      success: false,
      error: 'Endpoint not found in mock server'
    })
  };
}

/**
 * Check if mock mode is enabled
 * @returns {boolean} True if mock mode is enabled
 */
export function isMockModeEnabled() {
  // This can be controlled via environment variable or config
  return __ENV.MOCK_MODE === 'true' || __ENV.MOCK_MODE === true;
}

/**
 * Mock API request - simplified wrapper around getMockResponse
 * @param {string} url - API endpoint URL
 * @param {object} data - Request data (for POST requests)
 * @returns {object} - Mock response object
 */
export function mockRequest(url, data = null) {
  return getMockResponse(url, data);
}
