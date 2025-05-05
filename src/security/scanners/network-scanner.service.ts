import { AlertService } from '@alerts/alert.service';
import {
  SECURITY_SCANNER_CONFIG,
  SECURITY_TEST_METHODS,
  VulnerabilityType,
  XDC_SECURITY_CONFIG,
} from '@common/constants/security';
import { ConfigService } from '@config/config.service';
import { MetricsService } from '@metrics/metrics.service';
import { Injectable, Logger } from '@nestjs/common';
import { EndpointResult, NetworkScannerOptions, ScanResult, SeverityLevel, Vulnerability } from '@types';
import axios, { AxiosRequestConfig } from 'axios';
import * as fs from 'fs';
import * as https from 'https';
import * as path from 'path';

@Injectable()
export class NetworkScannerService {
  private readonly logger = new Logger(NetworkScannerService.name);
  private options: NetworkScannerOptions;
  private httpsAgent: https.Agent;
  private vulnerabilities: Vulnerability[] = [];
  private scannedEndpoints = 0;

  constructor(
    private readonly configService: ConfigService,
    private readonly alertService: AlertService,
    private readonly metricsService: MetricsService,
  ) {
    this.options = {
      timeout: SECURITY_SCANNER_CONFIG.DEFAULT_TIMEOUT,
      concurrency: SECURITY_SCANNER_CONFIG.DEFAULT_CONCURRENCY,
      reportPath: path.join(process.cwd(), SECURITY_SCANNER_CONFIG.DEFAULT_REPORT_PATH),
    };

    // Create the reports directory if it doesn't exist
    if (!fs.existsSync(this.options.reportPath)) {
      fs.mkdirSync(this.options.reportPath, { recursive: true });
    }

    this.httpsAgent = new https.Agent({
      rejectUnauthorized: false, // Allow self-signed certs for scanning
    });

    this.logger.log('Network Scanner Service initialized');
  }

  /**
   * Scan a list of targets (IPs or hostnames)
   * @param targets List of target IPs or hostnames
   */
  async scanTargets(targets: string[]): Promise<ScanResult[]> {
    this.logger.log(`Starting network scan of ${targets.length} targets...`);

    const startTime = Date.now();
    const results: ScanResult[] = [];
    this.vulnerabilities = [];
    this.scannedEndpoints = 0;

    // Process targets in batches for concurrency control
    for (let i = 0; i < targets.length; i += this.options.concurrency) {
      const batch = targets.slice(i, i + this.options.concurrency);
      const batchResults = await Promise.all(batch.map(target => this.scanTarget(target)));
      results.push(...batchResults.filter(r => r !== null));
    }

    const scanTime = ((Date.now() - startTime) / 1000).toFixed(2);
    this.logger.log(`Scan complete! Scanned ${this.scannedEndpoints} endpoints in ${scanTime}s`);
    this.logger.log(`Found ${this.vulnerabilities.length} potential vulnerabilities`);

    // Record scan metrics
    this.recordScanMetrics(results);

    // Generate alerts for critical vulnerabilities
    this.generateVulnerabilityAlerts(results);

    return results;
  }

  /**
   * Scan a single target for vulnerabilities
   * @param target IP or hostname to scan
   */
  private async scanTarget(target: string): Promise<ScanResult | null> {
    this.logger.debug(`Scanning target: ${target}`);

    // Add protocol if missing
    if (!target.startsWith('http')) {
      target = `http://${target}`;
    }

    const vulnerabilities: Vulnerability[] = [];
    const endpoints = this.generateEndpoints(target);

    for (const endpoint of endpoints) {
      try {
        this.scannedEndpoints++;
        const result = await this.testEndpoint(endpoint);
        if (result.vulnerabilities.length > 0) {
          vulnerabilities.push(...result.vulnerabilities);
          this.vulnerabilities.push(...result.vulnerabilities);
        }
      } catch (error) {
        // Endpoint not accessible, which is expected for most cases
        // this.logger.debug(`Failed to scan ${endpoint}: ${error.message}`);
      }
    }

    if (vulnerabilities.length === 0) {
      return null;
    }

    return {
      target,
      timestamp: new Date().toISOString(),
      vulnerabilities,
    };
  }

  /**
   * Generate a list of endpoints to test for a target
   * @param target Base target URL
   * @returns List of endpoints to test
   */
  private generateEndpoints(target: string): string[] {
    const endpoints: string[] = [];

    // Test standard HTTP RPC ports
    for (const port of XDC_SECURITY_CONFIG.RPC_PORTS) {
      const baseUrl = target.includes(':') ? target : `${target}:${port}`;
      endpoints.push(baseUrl, `${baseUrl}/`, `${baseUrl}/rpc`, `${baseUrl}/xdc`);
    }

    return endpoints;
  }

  /**
   * Test an endpoint for common RPC vulnerabilities
   * @param endpoint Endpoint URL to test
   */
  private async testEndpoint(endpoint: string): Promise<EndpointResult> {
    const vulnerabilities: Vulnerability[] = [];

    // Try standard JSON-RPC call to eth_blockNumber
    try {
      const startTime = Date.now();
      const response = await axios.post(
        endpoint,
        {
          jsonrpc: '2.0',
          method: 'eth_blockNumber',
          params: [],
          id: 1,
        },
        {
          timeout: this.options.timeout,
          httpsAgent: this.httpsAgent,
          headers: {
            'Content-Type': 'application/json',
          },
        } as AxiosRequestConfig,
      );

      const responseTime = Date.now() - startTime;

      // Check if this is a valid JSON-RPC endpoint
      if (response.data && response.data.result) {
        this.logger.debug(`Found active RPC endpoint: ${endpoint}`);

        // Add vulnerability for exposed RPC endpoint
        vulnerabilities.push({
          type: VulnerabilityType.EXPOSED_RPC,
          severity: SeverityLevel.MEDIUM,
          message: `Exposed JSON-RPC endpoint: ${endpoint}`,
          details: { responseTime },
        });
        
        // Note: We're not checking for performance/latency issues here
        // as these are already monitored by the XDCMonitor monitoring system

        // Check for exposed headers
        const headers = response.headers;
        const exposedHeaders = Object.keys(headers).filter(
          h =>
            h.toLowerCase().includes('server') ||
            h.toLowerCase().includes('version') ||
            h.toLowerCase().includes('engine'),
        );

        if (exposedHeaders.length > 0) {
          vulnerabilities.push({
            type: VulnerabilityType.INFORMATION_DISCLOSURE,
            severity: SeverityLevel.LOW,
            message: 'Server information disclosed in headers',
            details: { exposedHeaders },
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
   * @param endpoint Endpoint URL
   * @param vulnerabilities Vulnerabilities array to append to
   */
  private async checkExposedMethods(endpoint: string, vulnerabilities: Vulnerability[]): Promise<void> {
    // Check for exposed administrative methods
    for (const api of Object.keys(SECURITY_TEST_METHODS)) {
      try {
        // Try a method from this API namespace
        const method = `${api}_${SECURITY_TEST_METHODS[api]}`;

        const response = await axios.post(
          endpoint,
          {
            jsonrpc: '2.0',
            method,
            params: [],
            id: 1,
          },
          {
            timeout: this.options.timeout,
            httpsAgent: this.httpsAgent,
            headers: {
              'Content-Type': 'application/json',
            },
          } as AxiosRequestConfig,
        );

        // Check if method is available (either returns a result or a proper error)
        // If we get a "method not found" error, the API exists but this method doesn't
        // If we get a result or another error, the API is likely exposed
        if (response.data) {
          if (
            response.data.result !== undefined ||
            (response.data.error && !response.data.error.message?.includes('method not found'))
          ) {
            vulnerabilities.push({
              type: VulnerabilityType.ADMIN_API_EXPOSED,
              severity: SeverityLevel.CRITICAL,
              message: `Admin API exposed: ${api} namespace accessible`,
              details: {
                method,
                response: response.data.result || response.data.error,
              },
            });
          }
        }
      } catch (error) {
        // Method not accessible, this is expected
      }
    }

    // Also check for missing authentication
    try {
      const response = await axios.post(
        endpoint,
        {
          jsonrpc: '2.0',
          method: 'net_peerCount',
          params: [],
          id: 1,
        },
        {
          timeout: this.options.timeout,
          httpsAgent: this.httpsAgent,
          headers: {
            'Content-Type': 'application/json',
          },
        } as AxiosRequestConfig,
      );

      if (response.data && response.data.result) {
        const peerCount = parseInt(response.data.result, 16);

        // Check if the node has zero peers
        if (peerCount === 0) {
          vulnerabilities.push({
            type: VulnerabilityType.PERFORMANCE,
            severity: SeverityLevel.HIGH,
            message: 'Node has 0 peers, potential isolation or misconfiguration',
            details: { peerCount },
          });
        }
      }
    } catch (error) {
      // Method not accessible, this is expected
    }
  }

  /**
   * Record scan metrics in InfluxDB
   * @param results Scan results
   */
  private recordScanMetrics(results: ScanResult[]): void {
    try {
      if (!results || results.length === 0) return;

      // Count vulnerabilities by severity
      const criticalVulns = this.vulnerabilities.filter(v => v.severity === SeverityLevel.CRITICAL).length;
      const highVulns = this.vulnerabilities.filter(v => v.severity === SeverityLevel.HIGH).length;
      const mediumVulns = this.vulnerabilities.filter(v => v.severity === SeverityLevel.MEDIUM).length;
      const lowVulns = this.vulnerabilities.filter(v => v.severity === SeverityLevel.LOW).length;

      // Record overall scan metrics using the SecurityMetricsService
      this.metricsService.recordNetworkScanMetrics(
        this.scannedEndpoints,
        results.length,
        criticalVulns,
        highVulns,
        mediumVulns,
        lowVulns,
      );

      // Count vulnerability types
      const typeCounts: Record<string, number> = {};
      for (const vuln of this.vulnerabilities) {
        const typeName = vuln.type.toString();
        typeCounts[typeName] = (typeCounts[typeName] || 0) + 1;
      }

      // Record vulnerability type distribution
      this.metricsService.recordVulnerabilityTypes(typeCounts);
    } catch (error) {
      this.logger.error(`Failed to record scan metrics: ${error.message}`);
    }
  }

  /**
   * Generate alerts for critical vulnerabilities
   * @param results Scan results
   */
  private generateVulnerabilityAlerts(results: ScanResult[]): void {
    try {
      if (!results || results.length === 0) return;

      // Find all critical vulnerabilities
      const criticalVulns = [];

      for (const result of results) {
        for (const vuln of result.vulnerabilities) {
          if (vuln.severity === SeverityLevel.CRITICAL) {
            criticalVulns.push({
              target: result.target,
              type: vuln.type,
              message: vuln.message,
            });
          }
        }
      }

      // Generate alerts if there are critical vulnerabilities
      if (criticalVulns.length > 0) {
        let message = '## Critical Network Security Vulnerabilities Detected\n\n';
        message += `The following critical vulnerabilities were found:\n\n`;
        message += '| Target | Vulnerability |\n';
        message += '| ------ | ------------- |\n';

        for (const vuln of criticalVulns.slice(0, 10)) {
          message += `| ${vuln.target} | ${vuln.message} |\n`;
        }

        if (criticalVulns.length > 10) {
          message += `\n_${criticalVulns.length - 10} more critical vulnerabilities found. See full report for details._`;
        }

        // Add the alert
        this.alertService.addAlert({
          type: 'error',
          title: 'Critical Network Security Vulnerabilities Detected',
          message,
          component: 'security',
        });
      }
    } catch (error) {
      this.logger.error(`Failed to generate vulnerability alerts: ${error.message}`);
    }
  }
}
