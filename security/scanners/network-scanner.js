/**
 * XDC Network Security Scanner
 * 
 * This scanner detects exposed and vulnerable RPC endpoints in XDC Network nodes.
 * It checks for common security misconfigurations and vulnerabilities in node connectivity.
 */

import axios from 'axios';
import fs from 'fs';
import https from 'https';
import path from 'path';
import { SCAN_CONFIG, XDC_CONFIG } from '../config/constants.js';

class NetworkScanner {
  constructor(options = {}) {
    this.options = {
      timeout: 5000,
      concurrency: 5,
      reportPath: SCAN_CONFIG.DEFAULT_REPORT_PATH,
      ...options
    };
    
    // Create the reports directory if it doesn't exist
    if (!fs.existsSync(this.options.reportPath)) {
      fs.mkdirSync(this.options.reportPath, { recursive: true });
    }
    
    this.vulnerabilities = [];
    this.scannedEndpoints = 0;
    this.httpsAgent = new https.Agent({
      rejectUnauthorized: false // Allow self-signed certs for scanning
    });
  }
  
  /**
   * Scan a list of targets (IPs or hostnames)
   * @param {Array<string>} targets - List of target IPs or hostnames
   */
  async scanTargets(targets) {
    console.log(`Starting network scan of ${targets.length} targets...`);
    
    const startTime = Date.now();
    const results = [];
    
    // Process targets in batches for concurrency control
    for (let i = 0; i < targets.length; i += this.options.concurrency) {
      const batch = targets.slice(i, i + this.options.concurrency);
      const batchResults = await Promise.all(
        batch.map(target => this.scanTarget(target))
      );
      results.push(...batchResults.filter(r => r !== null));
    }
    
    const scanTime = ((Date.now() - startTime) / 1000).toFixed(2);
    console.log(`Scan complete! Scanned ${this.scannedEndpoints} endpoints in ${scanTime}s`);
    console.log(`Found ${this.vulnerabilities.length} potential vulnerabilities`);
    
    this.saveReport(results);
    return results;
  }
  
  /**
   * Scan a single target for vulnerabilities
   * @param {string} target - IP or hostname to scan
   */
  async scanTarget(target) {
    console.log(`Scanning target: ${target}`);
    
    // Add protocol if missing
    if (!target.startsWith('http')) {
      target = `http://${target}`;
    }
    
    const vulnerabilities = [];
    const endpoints = this.generateEndpoints(target);
    
    for (const endpoint of endpoints) {
      try {
        this.scannedEndpoints++;
        const result = await this.testEndpoint(endpoint);
        if (result.vulnerabilities.length > 0) {
          vulnerabilities.push(...result.vulnerabilities);
        }
      } catch (error) {
        // Endpoint not accessible, which is expected for most cases
        // console.log(`Failed to scan ${endpoint}: ${error.message}`);
      }
    }
    
    if (vulnerabilities.length === 0) {
      return null;
    }
    
    return {
      target,
      timestamp: new Date().toISOString(),
      vulnerabilities
    };
  }
  
  /**
   * Generate a list of endpoints to test for a target
   * @param {string} target - Base target URL
   * @returns {Array<string>} - List of endpoints to test
   */
  generateEndpoints(target) {
    const endpoints = [];
    
    // Test standard HTTP RPC ports
    for (const port of XDC_CONFIG.RPC_PORTS) {
      const baseUrl = target.includes(':') ? target : `${target}:${port}`;
      endpoints.push(
        baseUrl,
        `${baseUrl}/`,
        `${baseUrl}/rpc`,
        `${baseUrl}/xdc`
      );
    }
    
    return endpoints;
  }
  
  /**
   * Test an endpoint for common RPC vulnerabilities
   * @param {string} endpoint - Endpoint URL to test
   */
  async testEndpoint(endpoint) {
    const vulnerabilities = [];
    
    // Try standard JSON-RPC call to eth_blockNumber
    try {
      const startTime = Date.now();
      const response = await axios.post(endpoint, {
        jsonrpc: '2.0',
        method: 'eth_blockNumber',
        params: [],
        id: 1
      }, {
        timeout: this.options.timeout,
        httpsAgent: this.httpsAgent,
        headers: {
          'Content-Type': 'application/json'
        }
      });
      
      const responseTime = Date.now() - startTime;
      
      // Check if this is a valid JSON-RPC endpoint
      if (response.data && response.data.result) {
        console.log(`Found active RPC endpoint: ${endpoint}`);
        
        // Check response time
        if (responseTime > XDC_CONFIG.THRESHOLDS.MAX_RESPONSE_TIME_MS) {
          vulnerabilities.push({
            type: 'PERFORMANCE',
            severity: SCAN_CONFIG.SEVERITY_LEVELS.MEDIUM,
            message: `Slow RPC response time: ${responseTime}ms`,
            details: { responseTime }
          });
        }
        
        // Check for exposed headers
        const headers = response.headers;
        const exposedHeaders = Object.keys(headers).filter(h => 
          h.toLowerCase().includes('server') || 
          h.toLowerCase().includes('version') ||
          h.toLowerCase().includes('engine')
        );
        
        if (exposedHeaders.length > 0) {
          vulnerabilities.push({
            type: 'INFORMATION_DISCLOSURE',
            severity: SCAN_CONFIG.SEVERITY_LEVELS.LOW,
            message: 'Server information disclosed in headers',
            details: { exposedHeaders }
          });
        }
        
        // Now check for exposed admin methods
        await this.checkExposedMethods(endpoint, vulnerabilities);
      }
    } catch (error) {
      // Not a vulnerable endpoint or not accessible
    }
    
    return { endpoint, vulnerabilities };
  }
  
  /**
   * Check for exposed admin methods on an RPC endpoint
   * @param {string} endpoint - Endpoint URL
   * @param {Array} vulnerabilities - Vulnerabilities array to append to
   */
  async checkExposedMethods(endpoint, vulnerabilities) {
    // Test for exposed restricted APIs
    for (const api of XDC_CONFIG.RESTRICTED_APIS) {
      try {
        // Try a method from this API namespace
        const method = `${api}_${this.getTestMethodForApi(api)}`;
        
        const response = await axios.post(endpoint, {
          jsonrpc: '2.0',
          method,
          params: [],
          id: 1
        }, {
          timeout: this.options.timeout,
          httpsAgent: this.httpsAgent
        });
        
        // If we didn't get a "method not found" error, the API might be exposed
        if (response.data && !response.data.error) {
          vulnerabilities.push({
            type: 'EXPOSED_API',
            severity: SCAN_CONFIG.SEVERITY_LEVELS.CRITICAL,
            message: `Exposed admin API: ${api}`,
            details: { method, response: response.data }
          });
        } else if (response.data && 
                 response.data.error && 
                 !response.data.error.message.includes('method not found')) {
          // If we get an error but not "method not found", the API might exist
          vulnerabilities.push({
            type: 'POTENTIALLY_EXPOSED_API',
            severity: SCAN_CONFIG.SEVERITY_LEVELS.HIGH,
            message: `Potentially exposed admin API: ${api}`,
            details: { method, error: response.data.error }
          });
        }
      } catch (error) {
        // API not exposed or endpoint not accessible
      }
    }
  }
  
  /**
   * Get a test method for a specific API namespace
   */
  getTestMethodForApi(api) {
    switch(api) {
      case 'admin': return 'nodeInfo';
      case 'debug': return 'metrics';
      case 'personal': return 'listAccounts';
      case 'miner': return 'start';
      default: return 'methods';
    }
  }
  
  /**
   * Save scan results to a JSON report file
   * @param {Array} results - Scan results
   */
  saveReport(results) {
    const timestamp = new Date().toISOString().replace(/:/g, '-');
    const reportPath = path.join(this.options.reportPath, `network-scan-${timestamp}.json`);
    
    const report = {
      timestamp,
      summary: {
        scannedEndpoints: this.scannedEndpoints,
        vulnerableTargets: results.length,
        totalVulnerabilities: this.vulnerabilities.length,
        criticalVulnerabilities: this.vulnerabilities.filter(
          v => v.severity === SCAN_CONFIG.SEVERITY_LEVELS.CRITICAL
        ).length,
        highVulnerabilities: this.vulnerabilities.filter(
          v => v.severity === SCAN_CONFIG.SEVERITY_LEVELS.HIGH
        ).length
      },
      results
    };
    
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
    console.log(`Report saved to: ${reportPath}`);
  }
}

// Allow direct execution from command line
// In ES modules, there's no direct equivalent to require.main === module
// We can check if the import.meta.url matches the file being executed
if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  
  if (args.length === 0 || args.includes('--help')) {
    console.log(`
XDC Network Security Scanner

Usage:
  node network-scanner.js --targets FILE [options]

Options:
  --targets FILE      File containing list of targets to scan (one per line)
  --timeout MS        Request timeout in milliseconds (default: 5000)
  --concurrency N     Number of concurrent scans (default: 5)
  --output DIR        Directory to save reports (default: ../reports)
    `);
    process.exit(0);
  }
  
  // Parse command line arguments
  const options = {};
  let targetsFile = null;
  
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--targets' && i + 1 < args.length) {
      targetsFile = args[i + 1];
      i++;
    } else if (args[i] === '--timeout' && i + 1 < args.length) {
      options.timeout = parseInt(args[i + 1], 10);
      i++;
    } else if (args[i] === '--concurrency' && i + 1 < args.length) {
      options.concurrency = parseInt(args[i + 1], 10);
      i++;
    } else if (args[i] === '--output' && i + 1 < args.length) {
      options.reportPath = args[i + 1];
      i++;
    }
  }
  
  if (!targetsFile) {
    console.error('Error: --targets option is required');
    process.exit(1);
  }
  
  try {
    const targets = fs.readFileSync(targetsFile, 'utf8')
      .split('\n')
      .map(t => t.trim())
      .filter(t => t && !t.startsWith('#'));
    
    const scanner = new NetworkScanner(options);
    scanner.scanTargets(targets).catch(error => {
      console.error('Scan failed:', error);
    });
  } catch (error) {
    console.error(`Error reading targets file: ${error.message}`);
    process.exit(1);
  }
}

export default NetworkScanner;
