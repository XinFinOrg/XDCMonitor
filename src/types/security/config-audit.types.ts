/**
 * Types for configuration auditing and findings
 */
import { ConfigVulnerabilityType, SeverityLevel } from '@types';

/**
 * Security rule definition for configuration auditing
 */
export interface SecurityRule {
  id: string;
  description: string;
  severity: SeverityLevel;
  type: ConfigVulnerabilityType;
  check: (config: any) => boolean;
  remediation: string;
}

/**
 * Configuration audit finding details
 */
export interface Finding {
  rule: string;
  description: string;
  severity: SeverityLevel;
  type: string;
  remediation: string;
  context?: any;
}

/**
 * Complete audit results for a configuration file
 */
export interface AuditResult {
  file: string;
  timestamp: string;
  findings: Finding[];
}

/**
 * Options for configuration auditor operation
 */
export interface ConfigAuditorOptions {
  reportPath?: string;
  verbose?: boolean;
}
