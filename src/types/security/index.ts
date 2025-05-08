/**
 * Main index file for security types - exports all security-related types
 */

import {
  ConfigVulnerabilityType,
  SECURITY_METRICS,
  SeverityLevel,
  VulnerabilityType,
} from '@common/constants/security';
export { ConfigVulnerabilityType, SECURITY_METRICS, SeverityLevel, VulnerabilityType };

// Chain configuration for security scanning
export interface ChainConfig {
  enabled: boolean;
  chainId: number;
  name: string;
  endpoints: string[];
}

// Security rule definition for configuration auditing
export interface SecurityRule {
  id: string;
  description: string;
  severity: SeverityLevel;
  type: ConfigVulnerabilityType;
  check: (config: any) => boolean;
  remediation: string;
}

// Configuration audit finding details
export interface Finding {
  rule: string;
  description: string;
  severity: SeverityLevel;
  type: string;
  remediation: string;
  context?: any;
}

// Complete audit results for a configuration file
export interface AuditResult {
  file: string;
  timestamp: string;
  findings: Finding[];
}

// Options for configuration auditor operation
export interface ConfigAuditorOptions {
  reportPath?: string;
  verbose?: boolean;
}

// Options for network scanner configuration
export interface NetworkScannerOptions {
  timeout?: number;
  concurrency?: number;
  reportPath?: string;
}

// Complete scan results for a target
export interface ScanResult {
  target: string;
  timestamp: string;
  vulnerabilities: Vulnerability[];
}

// Individual vulnerability finding details
export interface Vulnerability {
  type: string;
  severity: SeverityLevel;
  message: string;
  details?: any;
}

// Results for a specific endpoint
export interface EndpointResult {
  endpoint: string;
  vulnerabilities: Vulnerability[];
}

// Summary of security scan results with issue counts by severity
export interface SecuritySummary {
  vulnerableTargets: number;
  criticalIssues: number;
  highIssues: number;
  mediumIssues: number;
  lowIssues: number;
  lastScanTime: Date;
  status: 'ok' | 'warning' | 'critical';
}

// Filter options for vulnerability queries
export interface VulnerabilityFilter {
  severity?: string;
  type?: string;
}
