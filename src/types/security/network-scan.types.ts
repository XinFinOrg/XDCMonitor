/**
 * Types for network security scanning
 */
import { SeverityLevel } from '@common/constants/security';

/**
 * Options for network scanner configuration
 */
export interface NetworkScannerOptions {
  timeout?: number;
  concurrency?: number;
  reportPath?: string;
}

/**
 * Complete scan results for a target
 */
export interface ScanResult {
  target: string;
  timestamp: string;
  vulnerabilities: Vulnerability[];
}

/**
 * Individual vulnerability finding details
 */
export interface Vulnerability {
  type: string;
  severity: SeverityLevel;
  message: string;
  details?: any;
}

/**
 * Results for a specific endpoint
 */
export interface EndpointResult {
  endpoint: string;
  vulnerabilities: Vulnerability[];
}
