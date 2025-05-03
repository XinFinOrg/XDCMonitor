/**
 * Types related to security status and summary reporting
 */

/**
 * Summary of security scan results with issue counts by severity
 */
export interface SecuritySummary {
  vulnerableTargets: number;
  criticalIssues: number;
  highIssues: number;
  mediumIssues: number;
  lowIssues: number;
  lastScanTime: Date;
  status: 'ok' | 'warning' | 'critical';
}

/**
 * Filter options for vulnerability queries
 */
export interface VulnerabilityFilter {
  severity?: string;
  type?: string;
}
