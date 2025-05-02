import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@config/config.service';
import { AlertService } from '@alerts/alert.service';
import { MetricsService } from '@metrics/metrics.service';
import { SeverityLevel, ConfigVulnerabilityType } from '@common/constants/security';
import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';

// Using imported SeverityLevel and ConfigVulnerabilityType from constants

// Security rules for node configuration
interface SecurityRule {
  id: string;
  description: string;
  severity: SeverityLevel;
  type: ConfigVulnerabilityType;
  check: (config: any) => boolean;
  remediation: string;
}

// Configuration audit finding
interface Finding {
  rule: string;
  description: string;
  severity: SeverityLevel;
  type: string;
  remediation: string;
  context?: any;
}

// Configuration audit result
export interface AuditResult {
  file: string;
  timestamp: string;
  findings: Finding[];
}

interface ConfigAuditorOptions {
  reportPath?: string;
  verbose?: boolean;
}

@Injectable()
export class ConfigAuditorService {
  private readonly logger = new Logger(ConfigAuditorService.name);
  private options: ConfigAuditorOptions;
  private securityRules: SecurityRule[] = [];
  
  constructor(
    private readonly configService: ConfigService,
    private readonly alertService: AlertService,
    private readonly metricsService: MetricsService,
  ) {
    this.options = {
      reportPath: path.join(process.cwd(), 'reports', 'security'),
      verbose: false
    };
    
    // Create the reports directory if it doesn't exist
    if (!fs.existsSync(this.options.reportPath)) {
      fs.mkdirSync(this.options.reportPath, { recursive: true });
    }
    
    // Initialize security rules
    this.initializeSecurityRules();
    
    this.logger.log('Config Auditor Service initialized with ' + this.securityRules.length + ' security rules');
  }
  
  /**
   * Initialize security rules for configuration auditing
   */
  private initializeSecurityRules() {
    // RPC Security Rules
    this.securityRules.push({
      id: 'rpc-1',
      description: 'Insecure RPC port binding (allows all IPs)',
      severity: SeverityLevel.HIGH,
      type: ConfigVulnerabilityType.RPC_SECURITY,
      check: (config) => {
        if (!config.rpc) return false;
        return config.rpc.http && (
          config.rpc.http.addr === '0.0.0.0' || 
          config.rpc.http.addr === '*' || 
          !config.rpc.http.addr
        );
      },
      remediation: 'Bind RPC to localhost (127.0.0.1) or use a specific IP'
    });
    
    this.securityRules.push({
      id: 'rpc-2',
      description: 'Dangerous RPC APIs enabled',
      severity: SeverityLevel.CRITICAL,
      type: ConfigVulnerabilityType.RPC_SECURITY,
      check: (config) => {
        if (!config.rpc || !config.rpc.http || !config.rpc.http.api) return false;
        const apis = Array.isArray(config.rpc.http.api) ? 
          config.rpc.http.api : 
          config.rpc.http.api.split(',').map(a => a.trim());
          
        const dangerousApis = ['admin', 'debug', 'personal', 'miner', 'txpool'];
        return apis.some(api => dangerousApis.includes(api));
      },
      remediation: 'Disable dangerous APIs or restrict access with proper authentication'
    });
    
    this.securityRules.push({
      id: 'rpc-3',
      description: 'Missing CORS restrictions',
      severity: SeverityLevel.MEDIUM,
      type: ConfigVulnerabilityType.RPC_SECURITY,
      check: (config) => {
        if (!config.rpc || !config.rpc.http) return false;
        if (config.rpc.http.cors === undefined) return false;
        return config.rpc.http.cors === '*' || (
          Array.isArray(config.rpc.http.cors) && 
          config.rpc.http.cors.includes('*')
        );
      },
      remediation: 'Restrict CORS to specific domains needed for your applications'
    });
    
    // Network Security Rules
    this.securityRules.push({
      id: 'net-1',
      description: 'Low maxpeers setting (<25)',
      severity: SeverityLevel.LOW,
      type: ConfigVulnerabilityType.NETWORK_SECURITY,
      check: (config) => {
        if (!config.p2p) return false;
        return config.p2p.maxpeers < 25;
      },
      remediation: 'Increase maxpeers to at least 25 for better network connectivity'
    });
    
    this.securityRules.push({
      id: 'net-2',
      description: 'No peer discovery enabled',
      severity: SeverityLevel.MEDIUM,
      type: ConfigVulnerabilityType.NETWORK_SECURITY,
      check: (config) => {
        if (!config.p2p) return false;
        return config.p2p.nodiscover === true;
      },
      remediation: 'Enable peer discovery if this is not an isolated private node'
    });
    
    // Authentication Security Rules
    this.securityRules.push({
      id: 'auth-1',
      description: 'No JWT authentication for RPC',
      severity: SeverityLevel.HIGH,
      type: ConfigVulnerabilityType.AUTH_SECURITY,
      check: (config) => {
        if (!config.rpc || !config.rpc.http) return false;
        return !config.rpc.http.jwtSecret && !config.rpc.http.authfile;
      },
      remediation: 'Configure JWT authentication for RPC endpoints'
    });
    
    this.securityRules.push({
      id: 'auth-2',
      description: 'Weak or missing RPC authentication',
      severity: SeverityLevel.CRITICAL,
      type: ConfigVulnerabilityType.AUTH_SECURITY,
      check: (config) => {
        // For this check we need to examine if there are admin APIs enabled but no auth
        if (!config.rpc || !config.rpc.http || !config.rpc.http.api) return false;
        
        const apis = Array.isArray(config.rpc.http.api) ? 
          config.rpc.http.api : 
          config.rpc.http.api.split(',').map(a => a.trim());
          
        const dangerousApis = ['admin', 'debug', 'personal', 'miner', 'txpool'];
        const hasDangerousApis = apis.some(api => dangerousApis.includes(api));
        
        // If there are dangerous APIs but no authentication
        if (hasDangerousApis) {
          return !config.rpc.http.jwtSecret && !config.rpc.http.authfile;
        }
        
        return false;
      },
      remediation: 'Enable authentication or remove dangerous APIs'
    });
    
    // Resource Security Rules
    this.securityRules.push({
      id: 'res-1',
      description: 'Unlimited cache setting (may cause OOM)',
      severity: SeverityLevel.MEDIUM,
      type: ConfigVulnerabilityType.RESOURCE_SECURITY,
      check: (config) => {
        if (!config.cache) return false;
        return config.cache.cache > 8192 || config.cache.cache < 0;
      },
      remediation: 'Set a reasonable cache limit (e.g., 4096 or 8192) based on your server resources'
    });
    
    this.securityRules.push({
      id: 'res-2',
      description: 'Unlimited database handles (risk of file descriptor exhaustion)',
      severity: SeverityLevel.MEDIUM,
      type: ConfigVulnerabilityType.RESOURCE_SECURITY,
      check: (config) => {
        if (!config.db) return false;
        return config.db.handles > 2048 || config.db.handles < 0;
      },
      remediation: 'Set a reasonable database handle limit (e.g., 1024 or 2048)'
    });
    
    // General Security Rules
    this.securityRules.push({
      id: 'gen-1',
      description: 'Missing unlock account timeout',
      severity: SeverityLevel.HIGH,
      type: ConfigVulnerabilityType.GENERAL_SECURITY,
      check: (config) => {
        if (!config.account) return false;
        return config.account.unlock && !config.account.unlocktime;
      },
      remediation: 'Set a short unlock time (e.g., 300 seconds) for any unlocked accounts'
    });
    
    this.securityRules.push({
      id: 'gen-2',
      description: 'Excessive logging may expose sensitive information',
      severity: SeverityLevel.MEDIUM,
      type: ConfigVulnerabilityType.GENERAL_SECURITY,
      check: (config) => {
        if (!config.logging) return false;
        return config.logging.verbosity > 3;
      },
      remediation: 'Reduce verbosity level to 3 or lower in production'
    });
  }
  
  /**
   * Audit a directory of configuration files
   * @param configDir Directory containing configuration files
   */
  async auditConfigDir(configDir: string): Promise<AuditResult[]> {
    this.logger.log(`Auditing configuration directory: ${configDir}`);
    
    const results: AuditResult[] = [];
    
    // Check if the directory exists
    if (!fs.existsSync(configDir)) {
      this.logger.error(`Configuration directory not found: ${configDir}`);
      throw new Error(`Configuration directory not found: ${configDir}`);
    }
    
    // Get all configuration files in the directory
    const files = fs.readdirSync(configDir)
      .filter(file => 
        file.endsWith('.json') || 
        file.endsWith('.yaml') || 
        file.endsWith('.yml') || 
        file.endsWith('.toml')
      );
    
    this.logger.log(`Found ${files.length} configuration files to audit`);
    
    // Audit each file
    for (const file of files) {
      const filePath = path.join(configDir, file);
      try {
        const result = await this.auditConfigFile(filePath);
        results.push(result);
      } catch (error) {
        this.logger.error(`Failed to audit ${filePath}: ${error.message}`);
      }
    }
    
    // Record audit metrics
    this.recordAuditMetrics(results);
    
    // Generate alerts for critical findings
    this.generateAuditAlerts(results);
    
    return results;
  }
  
  /**
   * Audit a single configuration file
   * @param filePath Path to the configuration file
   */
  private async auditConfigFile(filePath: string): Promise<AuditResult> {
    this.logger.debug(`Auditing configuration file: ${filePath}`);
    
    // Load the configuration file
    const config = this.loadConfigFile(filePath);
    
    // Apply security rules
    const findings: Finding[] = [];
    
    for (const rule of this.securityRules) {
      try {
        if (rule.check(config)) {
          findings.push({
            rule: rule.id,
            description: rule.description,
            severity: rule.severity,
            type: rule.type.toString(),
            remediation: rule.remediation,
            context: this.extractRelevantContext(config, rule)
          });
        }
      } catch (error) {
        this.logger.warn(`Error applying rule ${rule.id} to ${filePath}: ${error.message}`);
      }
    }
    
    if (findings.length > 0) {
      this.logger.log(`Found ${findings.length} security issues in ${filePath}`);
    } else {
      this.logger.debug(`No security issues found in ${filePath}`);
    }
    
    return {
      file: filePath,
      timestamp: new Date().toISOString(),
      findings
    };
  }
  
  /**
   * Load a configuration file based on its extension
   * @param filePath Path to the configuration file
   */
  private loadConfigFile(filePath: string): any {
    const ext = path.extname(filePath).toLowerCase();
    const fileContent = fs.readFileSync(filePath, 'utf8');
    
    if (ext === '.json') {
      return JSON.parse(fileContent);
    } else if (ext === '.yaml' || ext === '.yml') {
      return yaml.load(fileContent);
    } else if (ext === '.toml') {
      // For TOML we would use a TOML parser, but for now we'll handle it as JSON
      // In a production environment, you should add the toml library
      this.logger.warn('TOML parsing not fully implemented, trying to parse as JSON');
      return JSON.parse(fileContent);
    } else {
      throw new Error(`Unsupported file extension: ${ext}`);
    }
  }
  
  /**
   * Extract relevant context from the configuration for a finding
   * @param config Configuration object
   * @param rule Security rule that triggered the finding
   */
  private extractRelevantContext(config: any, rule: SecurityRule): any {
    // Extract context based on rule type
    switch(rule.type) {
      case ConfigVulnerabilityType.RPC_SECURITY:
        return config.rpc || {};
      case ConfigVulnerabilityType.NETWORK_SECURITY:
        return config.p2p || {};
      case ConfigVulnerabilityType.AUTH_SECURITY:
        return {
          rpc: config.rpc || {},
          account: config.account || {}
        };
      case ConfigVulnerabilityType.RESOURCE_SECURITY:
        return {
          cache: config.cache || {},
          db: config.db || {}
        };
      case ConfigVulnerabilityType.GENERAL_SECURITY:
        return {
          account: config.account || {},
          logging: config.logging || {}
        };
      default:
        return {};
    }
  }
  
  /**
   * Record audit metrics in InfluxDB
   * @param results Audit results
   */
  private recordAuditMetrics(results: AuditResult[]): void {
    try {
      if (!results || results.length === 0) return;
      
      // Count findings by severity
      const criticalFindings = results.reduce((count, result) => 
        count + result.findings.filter(f => f.severity === SeverityLevel.CRITICAL).length, 0);
      
      const highFindings = results.reduce((count, result) => 
        count + result.findings.filter(f => f.severity === SeverityLevel.HIGH).length, 0);
      
      const mediumFindings = results.reduce((count, result) => 
        count + result.findings.filter(f => f.severity === SeverityLevel.MEDIUM).length, 0);
      
      const lowFindings = results.reduce((count, result) => 
        count + result.findings.filter(f => f.severity === SeverityLevel.LOW).length, 0);
      
      // Record overall audit metrics using SecurityMetricsService
      this.metricsService.recordConfigAuditMetrics(
        results.length,
        results.filter(r => r.findings.length > 0).length,
        criticalFindings,
        highFindings,
        mediumFindings,
        lowFindings
      );
      
      // Count unique finding types
      const findingTypes = {};
      for (const result of results) {
        for (const finding of result.findings) {
          findingTypes[finding.type] = (findingTypes[finding.type] || 0) + 1;
        }
      }
      
      // Record finding type distribution
      this.metricsService.recordFindingTypes(findingTypes);
    } catch (error) {
      this.logger.error(`Failed to record audit metrics: ${error.message}`);
    }
  }
  
  /**
   * Generate alerts for critical findings
   * @param results Audit results
   */
  private generateAuditAlerts(results: AuditResult[]): void {
    try {
      if (!results || results.length === 0) return;
      
      // Find all critical findings
      const criticalFindings = [];
      
      for (const result of results) {
        for (const finding of result.findings) {
          if (finding.severity === SeverityLevel.CRITICAL) {
            criticalFindings.push({
              config: result.file,
              rule: finding.rule,
              description: finding.description,
              remediation: finding.remediation
            });
          }
        }
      }
      
      // Generate alerts if there are critical findings
      if (criticalFindings.length > 0) {
        let message = '## Critical Configuration Security Issues Detected\n\n';
        message += `The following critical issues were found in node configurations:\n\n`;
        message += '| Configuration | Issue | Remediation |\n';
        message += '| ------------- | ----- | ----------- |\n';
        
        for (const finding of criticalFindings.slice(0, 10)) {
          message += `| ${path.basename(finding.config)} | ${finding.description} | ${finding.remediation} |\n`;
        }
        
        if (criticalFindings.length > 10) {
          message += `\n_${criticalFindings.length - 10} more critical issues found. See full report for details._`;
        }
        
        // Add the alert
        this.alertService.addAlert({
          type: 'error',
          title: 'Critical Configuration Security Issues Detected',
          message,
          component: 'security'
        });
      }
    } catch (error) {
      this.logger.error(`Failed to generate audit alerts: ${error.message}`);
    }
  }
}
