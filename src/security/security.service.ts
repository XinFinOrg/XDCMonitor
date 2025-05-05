import { AlertService } from '@alerts/alert.service';
import { ConfigService } from '@config/config.service';
import { MetricsService } from '@metrics/metrics.service';
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { CHAINS } from '@security/config/chains.config';
import { ConfigAuditorService } from '@security/scanners/config-auditor.service';
import { NetworkScannerService } from '@security/scanners/network-scanner.service';
import { AuditResult, ScanResult, SecuritySummary, SeverityLevel, VulnerabilityFilter } from '@types';
import * as fs from 'fs';
import * as path from 'path';

@Injectable()
export class SecurityService implements OnModuleInit {
  private readonly logger = new Logger(SecurityService.name);
  private securityStatus: 'idle' | 'scanning' | 'error' = 'idle';
  private lastScanDate: Date | null = null;
  private securitySummary: SecuritySummary = {
    vulnerableTargets: 0,
    criticalIssues: 0,
    highIssues: 0,
    mediumIssues: 0,
    lowIssues: 0,
    lastScanTime: new Date(),
    status: 'ok',
  };

  constructor(
    private readonly configService: ConfigService,
    private readonly networkScannerService: NetworkScannerService,
    private readonly configAuditorService: ConfigAuditorService,
    private readonly alertService: AlertService,
    private readonly metricsService: MetricsService,
  ) {}

  async onModuleInit() {
    this.logger.log('Security Service initialized');
    // Schedule initial scan after a short delay to ensure services are ready
    setTimeout(() => this.runScheduledSecurityScan(), 5000);
  }

  // Get security status information including last scan time and current security posture
  getSecurityStatus() {
    return {
      status: this.securityStatus,
      lastScan: this.lastScanDate,
      securityPosture: this.securitySummary.status,
      vulnerableTargets: this.securitySummary.vulnerableTargets,
      criticalIssues: this.securitySummary.criticalIssues,
      highIssues: this.securitySummary.highIssues,
    };
  }

  // Get all available chains and their status
  getAvailableChains() {
    return CHAINS.map(chain => ({
      name: chain.name,
      chainId: chain.chainId,
      enabled: chain.enabled,
      endpointCount: chain.endpoints.length,
    }));
  }

  // Run a security scan on a specific chain by name
  async scanSpecificChain(chainName: string): Promise<ScanResult[]> {
    this.logger.log(`Running targeted security scan for chain: ${chainName}`);

    const chain = CHAINS.find(c => c.name.toLowerCase() === chainName.toLowerCase());
    if (!chain) {
      this.logger.error(`Chain not found: ${chainName}`);
      throw new Error(`Chain not found: ${chainName}`);
    }

    const scanOptions = {
      [`scan${chain.name}`]: true, // Enable this specific chain
    };

    // Use the existing scanning logic but with options to enable only this chain
    return await this.runNetworkScan(scanOptions);
  }

  // Run only network security scan
  async runNetworkScan(options: any): Promise<ScanResult[]> {
    this.logger.log('Running network security scan');

    try {
      // Get targets from CHAINS configuration
      const allTargets: string[] = [];

      // Add custom targets if provided
      const customTargets: string[] = options.targets || [];
      if (customTargets.length > 0) {
        allTargets.push(...customTargets);
      }

      // Process chains based on their enabled status
      for (const chain of CHAINS) {
        // Skip disabled chains unless explicitly enabled for this scan
        if (!chain.enabled && !options[`scan${chain.name}`]) {
          this.logger.debug(`Skipping disabled chain: ${chain.name}`);
          continue;
        }

        // Skip chains explicitly disabled for this scan
        if (options[`skip${chain.name}`]) {
          this.logger.debug(`Explicitly skipping chain: ${chain.name}`);
          continue;
        }

        this.logger.log(`Adding targets from chain: ${chain.name}`);
        allTargets.push(...chain.endpoints);
      }

      // Fallback to config service values if no CHAINS are configured
      if (allTargets.length === 0 && customTargets.length === 0) {
        // Use the proper ConfigService methods for getting RPC endpoints
        const testnetTargets = this.configService.getTestnetRpcEndpoints();

        // By default, do not scan mainnet unless explicitly enabled
        const scanMainnet = options.scanMainnet === true;
        const mainnetTargets = scanMainnet ? this.configService.getMainnetRpcEndpoints() : [];

        allTargets.push(...testnetTargets, ...mainnetTargets);
      }

      if (allTargets.length === 0) {
        this.logger.warn('No targets specified for network scan');
        return [];
      }

      // Run the network scan
      return await this.networkScannerService.scanTargets(allTargets);
    } catch (err) {
      this.logger.error(`Network scan failed: ${err.message}`);
      throw err;
    }
  }

  // Run only configuration audit
  async runConfigAudit(options: any): Promise<AuditResult[]> {
    this.logger.log('Running configuration audit');

    try {
      if (!options.configDir) {
        throw new Error('No configuration directory specified');
      }

      return await this.configAuditorService.auditConfigDir(options.configDir);
    } catch (err) {
      this.logger.error(`Configuration audit failed: ${err.message}`);
      throw err;
    }
  }

  // Run regular security scans (daily by default)
  @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT)
  async runScheduledSecurityScan() {
    if (this.securityStatus === 'scanning') {
      this.logger.log('Security scan already in progress, skipping scheduled scan');
      return;
    }

    this.logger.log('Running scheduled security scan');
    this.securityStatus = 'scanning';
    this.lastScanDate = new Date();

    try {
      // Get enabled chains from configuration
      const enabledChains = CHAINS.filter(chain => chain.enabled);
      this.logger.log(`Found ${enabledChains.length} enabled chains in configuration`);

      // Log which chains will be scanned
      if (enabledChains.length > 0) {
        enabledChains.forEach(chain => {
          this.logger.log(`Will scan ${chain.name} chain with ${chain.endpoints.length} endpoints`);
        });
      } else {
        this.logger.warn('No chains are enabled in configuration, will use fallback values');
      }

      // Run network scan using the chain configuration
      const networkResults = await this.runNetworkScan({});

      // Run config audit if a config directory exists
      // Default to 'config' directory in project root
      const configDir = path.join(process.cwd(), 'config');
      let configResults = [];

      try {
        if (fs.existsSync(configDir)) {
          configResults = await this.runConfigAudit({ configDir });
        }
      } catch (error) {
        this.logger.warn(`Failed to audit config directory ${configDir}: ${error.message}`);
      }

      // Process the results and update metrics
      await this.processSecurityResults(networkResults, configResults);

      this.logger.log('Scheduled security scan completed successfully');
      this.securityStatus = 'idle';
    } catch (err) {
      this.logger.error(`Scheduled security scan failed: ${err.message}`);
      this.securityStatus = 'error';

      // Send alert for scan failure
      this.alertService.addAlert({
        type: 'error',
        title: 'Security Scan Failed',
        message: `Security scan failed: ${err.message}`,
        component: 'security',
      });
    }
  }

  /**
   * Process security scan results and update metrics and alerts
   * @param networkResults Network scan results
   * @param configResults Configuration audit results
   */
  private async processSecurityResults(networkResults: ScanResult[], configResults: AuditResult[]) {
    // Reset counters
    let vulnerableTargets = 0;
    let criticalIssues = 0;
    let highIssues = 0;
    let mediumIssues = 0;
    let lowIssues = 0;

    // Process network vulnerabilities
    if (networkResults && networkResults.length > 0) {
      vulnerableTargets += networkResults.length;

      // Count vulnerabilities by severity
      for (const result of networkResults) {
        if (!result.vulnerabilities) continue;

        for (const vuln of result.vulnerabilities) {
          switch (vuln.severity) {
            case SeverityLevel.CRITICAL:
              criticalIssues++;
              break;
            case SeverityLevel.HIGH:
              highIssues++;
              break;
            case SeverityLevel.MEDIUM:
              mediumIssues++;
              break;
            case SeverityLevel.LOW:
              lowIssues++;
              break;
          }
        }
      }
    }

    // Process configuration audit findings
    if (configResults && configResults.length > 0) {
      for (const result of configResults) {
        if (!result.findings) continue;

        // Count by severity
        for (const finding of result.findings) {
          switch (finding.severity) {
            case SeverityLevel.CRITICAL:
              criticalIssues++;
              break;
            case SeverityLevel.HIGH:
              highIssues++;
              break;
            case SeverityLevel.MEDIUM:
              mediumIssues++;
              break;
            case SeverityLevel.LOW:
              lowIssues++;
              break;
          }
        }
      }
    }

    // Update the security summary
    this.securitySummary = {
      vulnerableTargets,
      criticalIssues,
      highIssues,
      mediumIssues,
      lowIssues,
      lastScanTime: new Date(),
      status: this.determineSecurityStatus(criticalIssues, highIssues),
    };

    // Record metrics
    this.metricsService.recordSecurityScan(vulnerableTargets, criticalIssues, highIssues, mediumIssues, lowIssues);

    // Send alerts for critical issues
    if (criticalIssues > 0 || highIssues > 0) {
      this.sendSecurityAlert(networkResults, configResults);
    }
  }

  /**
   * Determine security status based on issue counts
   */
  private determineSecurityStatus(criticalIssues: number, highIssues: number): 'ok' | 'warning' | 'critical' {
    if (criticalIssues > 0) {
      return 'critical';
    } else if (highIssues > 0) {
      return 'warning';
    } else {
      return 'ok';
    }
  }

  /**
   * Send security alert for critical issues
   */
  private sendSecurityAlert(networkResults: ScanResult[], configResults: AuditResult[]) {
    const criticalCount = this.securitySummary.criticalIssues;
    const highCount = this.securitySummary.highIssues;

    // Determine alert type
    const alertType = criticalCount > 0 ? 'error' : 'warning';

    // Create alert message
    let message = `Security scan detected ${criticalCount} critical and ${highCount} high severity issues.`;

    // Add top vulnerabilities
    const networkVulns = this.getTopNetworkVulnerabilities(networkResults, 3);
    if (networkVulns.length > 0) {
      message += '\n\nTop network vulnerabilities:';
      for (const vuln of networkVulns) {
        message += `\n- ${this.getSeverityLabel(vuln.severity)}: ${vuln.message} on ${vuln.target || 'unknown target'}`;
      }
    }

    // Add top config findings
    const configFindings = this.getTopConfigFindings(configResults, 3);
    if (configFindings.length > 0) {
      message += '\n\nTop configuration issues:';
      for (const finding of configFindings) {
        message += `\n- ${this.getSeverityLabel(finding.severity)}: ${finding.description}`;
      }
    }

    // Add alert
    this.alertService.addAlert({
      type: alertType,
      title: 'Security Vulnerabilities Detected',
      message,
      component: 'security',
    });
  }

  /**
   * Get top configuration findings sorted by severity
   */
  private getTopConfigFindings(
    results: AuditResult[],
    limit: number,
  ): Array<{ severity: number; description: string }> {
    const allFindings: Array<{ severity: number; description: string }> = [];

    for (const result of results) {
      if (!result.findings) continue;

      for (const finding of result.findings) {
        allFindings.push({
          severity: finding.severity,
          description: finding.description,
        });
      }
    }

    // Sort by severity (highest first)
    return allFindings.sort((a, b) => b.severity - a.severity).slice(0, limit);
  }

  /**
   * Get top network vulnerabilities sorted by severity
   */
  private getTopNetworkVulnerabilities(
    results: ScanResult[],
    limit: number,
  ): Array<{ severity: number; message: string; target?: string }> {
    const allVulns: Array<{ severity: number; message: string; target?: string }> = [];

    for (const result of results) {
      if (!result.vulnerabilities) continue;

      for (const vuln of result.vulnerabilities) {
        allVulns.push({
          severity: vuln.severity,
          message: vuln.message,
          target: result.target,
        });
      }
    }

    // Sort by severity (highest first)
    return allVulns.sort((a, b) => b.severity - a.severity).slice(0, limit);
  }

  /**
   * Get a human-readable severity label
   */
  private getSeverityLabel(severityCode: number): string {
    switch (severityCode) {
      case SeverityLevel.CRITICAL:
        return 'CRITICAL';
      case SeverityLevel.HIGH:
        return 'HIGH';
      case SeverityLevel.MEDIUM:
        return 'MEDIUM';
      case SeverityLevel.LOW:
        return 'LOW';
      case SeverityLevel.INFO:
      default:
        return 'INFO';
    }
  }

  /**
   * Get active vulnerabilities with optional filtering
   * Returns vulnerabilities from the most recent scan results
   */
  async getVulnerabilities(filter: VulnerabilityFilter = {}): Promise<any[]> {
    try {
      // Run a scan to get the latest vulnerabilities
      const networkResults = await this.runNetworkScan({});

      // Use config directory in project root
      const configDir = path.join(process.cwd(), 'config');
      let configResults = [];

      // Try to run config audit if directory exists
      try {
        if (fs.existsSync(configDir)) {
          configResults = await this.runConfigAudit({ configDir });
        }
      } catch (error) {
        this.logger.warn(`Failed to audit config directory ${configDir}: ${error.message}`);
      }

      const vulnerabilities = [];
      let vulnCounter = 0;

      // Process network vulnerabilities
      for (const result of networkResults) {
        if (!result.vulnerabilities) continue;

        for (const vuln of result.vulnerabilities) {
          // Apply filtering if specified
          if (filter.severity && this.getSeverityLabel(vuln.severity) !== filter.severity.toUpperCase()) {
            continue;
          }
          if (filter.type && vuln.type !== filter.type) {
            continue;
          }

          vulnerabilities.push({
            id: `vuln-${++vulnCounter}`,
            target: result.target,
            timestamp: new Date().toISOString(),
            type: vuln.type,
            severity: vuln.severity,
            severityLabel: this.getSeverityLabel(vuln.severity),
            message: vuln.message,
            details: vuln.details,
            source: 'network',
          });
        }
      }

      // Process config findings
      for (const result of configResults) {
        if (!result.findings) continue;

        for (const finding of result.findings) {
          // Apply filtering if specified
          if (filter.severity && this.getSeverityLabel(finding.severity) !== filter.severity.toUpperCase()) {
            continue;
          }
          if (filter.type && finding.type !== filter.type) {
            continue;
          }

          vulnerabilities.push({
            id: `vuln-${++vulnCounter}`,
            target: result.file,
            timestamp: new Date().toISOString(),
            type: finding.type,
            severity: finding.severity,
            severityLabel: this.getSeverityLabel(finding.severity),
            message: finding.description,
            details: finding.context,
            source: 'config',
          });
        }
      }

      // Sort by severity (highest first)
      return vulnerabilities.sort((a, b) => b.severity - a.severity);
    } catch (error) {
      this.logger.error(`Failed to retrieve vulnerabilities: ${error.message}`);
      return [];
    }
  }

  /**
   * Record security metrics in InfluxDB
   */
  private recordSecurityMetrics(summary: any): void {
    try {
      if (!summary) return;

      // Use SecurityMetricsService to record the scan summary metrics
      this.metricsService.recordSecurityScan(
        summary.vulnerableTargets,
        summary.criticalIssues,
        summary.highIssues,
        summary.mediumIssues,
        summary.lowIssues,
      );

      this.logger.log('Recorded security scan metrics successfully');
    } catch (err) {
      this.logger.error(`Failed to record security metrics: ${err.message}`);
    }
  }
}
