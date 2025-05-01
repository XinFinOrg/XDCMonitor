/**
 * Stress Test Utilities
 * 
 * Common utilities and helper functions for all stress tests.
 * This module reduces code duplication and standardizes testing patterns.
 * 
 * Supports mock mode via MOCK_MODE environment variable:
 * k6 run -e MOCK_MODE=true tests/stress/full-pipeline-stress.js
 */

import { randomIntBetween } from 'https://jslib.k6.io/k6-utils/1.2.0/index.js';
import { check } from 'k6';
import http from 'k6/http';
import { getMockResponse, isMockModeEnabled } from './mock-server.js';

/**
 * Generate a random blockchain address (0x format)
 * @returns {string} Ethereum-format address
 */
export function randomAddress() {
  return '0x' + randomIntBetween(1, 999999).toString(16).padStart(40, '0');
}

/**
 * Generate a random transaction hash
 * @returns {string} Transaction hash
 */
export function randomTxHash() {
  return '0x' + randomIntBetween(1, 999999999).toString(16).padStart(64, '0');
}

/**
 * Generate a random block number in a realistic range
 * @returns {number} Block number
 */
export function randomBlockNumber() {
  return randomIntBetween(1000000, 9999999);
}

/**
 * Standard API response validation
 * @param {object} response K6 HTTP response object
 * @param {object} [options] Validation options
 * @returns {boolean} Whether all checks passed
 */
export function validateResponse(response, options = {}) {
  const { expectJson = true, customChecks = {} } = options;
  
  const checks = {
    'request successful': (r) => r.status === 200 || r.status === 201,
    ...customChecks
  };
  
  if (expectJson) {
    checks['valid response'] = (r) => {
      try {
        const body = JSON.parse(r.body);
        return body.success === true;
      } catch (e) {
        return false;
      }
    };
  }
  
  return check(response, checks);
}

/**
 * Generate properly formatted request headers
 * @returns {object} Headers object for HTTP requests
 */
export function getHeaders() {
  return { 'Content-Type': 'application/json' };
}

/**
 * Helper to POST to an API endpoint with standard error handling
 * @param {string} url Full URL
 * @param {object} payload Request body
 * @param {object} tags Request tags
 * @returns {object} K6 HTTP response
 */
export function apiPost(url, payload, tags = {}) {
  // Process tags to ensure they're all primitive values
  const processedTags = {};
  for (const [key, value] of Object.entries(tags)) {
    if (typeof value === 'object' && value !== null) {
      processedTags[key] = JSON.stringify(value);
    } else {
      processedTags[key] = value;
    }
  }
  
  // If mock mode is enabled, return a mock response instead of making a real HTTP request
  if (isMockModeEnabled()) {
    const mockResponse = getMockResponse(url, payload);
    // Create a response object that mimics the k6 HTTP response structure
    return {
      status: mockResponse.status,
      body: mockResponse.body,
      headers: {},
      timings: {
        duration: randomIntBetween(5, 50),
        waiting: randomIntBetween(2, 30)
      },
      request: {
        method: 'POST',
        url: url,
        body: JSON.stringify(payload),
        headers: getHeaders()
      }
    };
  }
  
  // Otherwise make a real HTTP request
  return http.post(
    url,
    JSON.stringify(payload),
    {
      headers: getHeaders(),
      tags: processedTags
    }
  );
}

/**
 * Helper to GET from an API endpoint with standard error handling
 * @param {string} url Full URL
 * @param {object} tags Request tags
 * @returns {object} K6 HTTP response
 */
export function apiGet(url, tags = {}) {
  // Process tags to ensure they're all primitive values
  const processedTags = {};
  for (const [key, value] of Object.entries(tags)) {
    if (typeof value === 'object' && value !== null) {
      processedTags[key] = JSON.stringify(value);
    } else {
      processedTags[key] = value;
    }
  }
  
  // If mock mode is enabled, return a mock response instead of making a real HTTP request
  if (isMockModeEnabled()) {
    const mockResponse = getMockResponse(url);
    // Create a response object that mimics the k6 HTTP response structure
    return {
      status: mockResponse.status,
      body: mockResponse.body,
      headers: {},
      timings: {
        duration: randomIntBetween(5, 50),
        waiting: randomIntBetween(2, 30)
      },
      request: {
        method: 'GET',
        url: url,
        headers: getHeaders()
      }
    };
  }
  
  return http.get(
    url,
    {
      headers: getHeaders(),
      tags: processedTags
    }
  );
}

/**
 * Generate random item from array
 * @param {Array} array Input array
 * @returns {*} Random item
 */
export function randomItem(array) {
  return array[Math.floor(Math.random() * array.length)];
}

/**
 * Convert object to query string
 * @param {object} params Object of parameters
 * @returns {string} URL query string (without leading ?)
 */
export function toQueryString(params) {
  return Object.keys(params)
    .map(key => `${encodeURIComponent(key)}=${encodeURIComponent(params[key])}`)
    .join('&');
}
