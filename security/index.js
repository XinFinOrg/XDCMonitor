/**
 * XDC Network Security Scanner
 * 
 * Main entry point for the XDC Network security scanning system.
 * This integrates all scanners into a unified security analysis framework.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { SCAN_CONFIG } from './config/constants.js';
import ConfigAuditor from './scanners/config-auditor.js';
import NetworkScanner from './scanners/network-scanner.js';

// Get dirname equivalent in ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

class SecurityScanner {
  constructor(options = {}) {
    this.options = {
      reportPath: path.join(__dirname, 'reports'),
      verbose: false,
      ...options
    };
    
    // Initialize scanners
    this.networkScanner = new NetworkScanner({ 
      reportPath: this.options.reportPath,
      concurrency: 5,
      timeout: 5000
    });
    
    this.configAuditor = new ConfigAuditor({
      reportPath: this.options.reportPath,
      verbose: this.options.verbose
    });
    
    // Ensure reports directory exists
    if (!fs.existsSync(this.options.reportPath)) {
      fs.mkdirSync(this.options.reportPath, { recursive: true });
    }
  }
  
  /**
   * Run a comprehensive security scan
   * @param {Object} options - Scan options 
   */
  async runComprehensiveScan(options = {}) {
    console.log('Starting comprehensive XDC Network security scan');
    
    const startTime = Date.now();
    const results = {
      timestamp: new Date().toISOString(),
      network: null,
      config: null
    };
    
    // 1. Run network security scan
    if (options.targetsFile) {
      console.log('Running network security scan...');
      const targets = fs.readFileSync(options.targetsFile, 'utf8')
        .split('\n')
        .map(t => t.trim())
        .filter(t => t && !t.startsWith('#'));
        
      try {
        results.network = await this.networkScanner.scanTargets(targets);
      } catch (error) {
        console.error('Network scan failed:', error.message);
      }
    }
    
    // Smart contract analysis removed as per requirements
    
    // 3. Run node configuration audit
    if (options.configDir) {
      console.log('Running node configuration audit...');
      try {
        results.config = await this.configAuditor.auditConfigDir(options.configDir);
      } catch (error) {
        console.error('Configuration audit failed:', error.message);
      }
    }
    
    const totalTime = ((Date.now() - startTime) / 1000 / 60).toFixed(2);
    console.log(`Comprehensive security scan completed in ${totalTime} minutes`);
    
    // Save comprehensive report
    this.saveComprehensiveReport(results);
    
    return results;
  }
  
  /**
   * Save a comprehensive security report
   * @param {Object} results - Scan results
   */
  saveComprehensiveReport(results) {
    const timestamp = new Date().toISOString().replace(/:/g, '-');
    const reportPath = path.join(this.options.reportPath, `comprehensive-scan-${timestamp}.json`);
    
    fs.writeFileSync(reportPath, JSON.stringify(results, null, 2));
    console.log(`Comprehensive report saved to: ${reportPath}`);
    
    // Also generate a summary report in markdown
    this.generateSummaryReport(results, timestamp);
  }
  
  /**
   * Generate a summary report in markdown format
   * @param {Object} results - Scan results
   * @param {string} timestamp - Scan timestamp
   */
  generateSummaryReport(results, timestamp) {
    const summaryPath = path.join(this.options.reportPath, `summary-${timestamp}.md`);
    
    let summary = `# XDC Network Security Scan Summary\n\n`;
    summary += `**Scan Date:** ${new Date(results.timestamp).toLocaleString()}\n\n`;
    
    // Network scan summary
    if (results.network) {
      const vulnerableTargets = results.network.length;
      const criticalIssues = results.network.reduce((count, target) => {
        return count + target.vulnerabilities.filter(v => v.severity === SCAN_CONFIG.SEVERITY_LEVELS.CRITICAL).length;
      }, 0);
      
      summary += `## Network Security\n\n`;
      summary += `- **Vulnerable Targets:** ${vulnerableTargets}\n`;
      summary += `- **Critical Issues:** ${criticalIssues}\n\n`;
      
      if (vulnerableTargets > 0) {
        summary += `### Top Findings\n\n`;
        summary += `| Target | Severity | Issue |\n`;
        summary += `| ------ | -------- | ----- |\n`;
        
        // Add top 5 findings
        const findings = [];
        results.network.forEach(target => {
          target.vulnerabilities.forEach(v => {
            findings.push({
              target: target.target,
              severity: v.severity,
              message: v.message
            });
          });
        });
        
        // Sort by severity (highest first)
        findings.sort((a, b) => b.severity - a.severity);
        
        findings.slice(0, 5).forEach(f => {
          const severity = this.getSeverityLabel(f.severity);
          summary += `| ${f.target} | ${severity} | ${f.message} |\n`;
        });
        
        summary += '\n';
      }
    }
    
    // Contract analysis removed as per requirements
    
    // Configuration audit summary
    if (results.config) {
      const configsWithIssues = results.config.filter(c => c.findings.length > 0).length;
      const criticalIssues = results.config.reduce((count, config) => {
        return count + config.findings.filter(f => f.severity === SCAN_CONFIG.SEVERITY_LEVELS.CRITICAL).length;
      }, 0);
      
      summary += `## Node Configuration Security\n\n`;
      summary += `- **Configurations Audited:** ${results.config.length}\n`;
      summary += `- **Configurations With Issues:** ${configsWithIssues}\n`;
      summary += `- **Critical Issues:** ${criticalIssues}\n\n`;
      
      if (configsWithIssues > 0) {
        summary += `### Top Findings\n\n`;
        summary += `| Configuration | Severity | Issue |\n`;
        summary += `| ------------- | -------- | ----- |\n`;
        
        // Add top 5 findings
        const findings = [];
        results.config.forEach(config => {
          config.findings.forEach(f => {
            findings.push({
              config: path.basename(config.file),
              severity: f.severity,
              message: f.description
            });
          });
        });
        
        // Sort by severity (highest first)
        findings.sort((a, b) => b.severity - a.severity);
        
        findings.slice(0, 5).forEach(f => {
          const severity = this.getSeverityLabel(f.severity);
          summary += `| ${f.config} | ${severity} | ${f.message} |\n`;
        });
        
        summary += '\n';
      }
    }
    
    // Recommendations
    summary += `## Recommendations\n\n`;
    summary += `1. **Network Security:** Ensure all RPC endpoints are properly secured and not exposing admin APIs\n`;
    summary += `2. **Node Configuration:** Follow best practices for XDC node configuration\n`;
    summary += `3. **Regular Scanning:** Set up automated security scanning as part of your CI/CD pipeline\n\n`;
    
    // Footer
    summary += `---\n\n`;
    summary += `Generated by XDC Network Security Scanner | ${new Date().toISOString()}\n`;
    
    fs.writeFileSync(summaryPath, summary);
    console.log(`Summary report saved to: ${summaryPath}`);
  }
  
  /**
   * Get a human-readable severity label
   * @param {number} severity - Severity level
   * @returns {string} - Severity label
   */
  getSeverityLabel(severity) {
    switch (severity) {
      case SCAN_CONFIG.SEVERITY_LEVELS.CRITICAL:
        return 'CRITICAL';
      case SCAN_CONFIG.SEVERITY_LEVELS.HIGH:
        return 'HIGH';
      case SCAN_CONFIG.SEVERITY_LEVELS.MEDIUM:
        return 'MEDIUM';
      case SCAN_CONFIG.SEVERITY_LEVELS.LOW:
        return 'LOW';
      default:
        return 'INFO';
    }
  }
}

// Allow direct execution from command line
// In ES modules, there's no direct equivalent to require.main === module
if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  
  if (args.length === 0 || args.includes('--help')) {
    console.log(`
XDC Network Security Scanner

Usage:
  node index.js --comprehensive [options]
  node index.js --network --targets FILE [options]
  node index.js --config --dir DIR [options]

Options:
  --comprehensive       Run all security scans
  --network             Run network security scan
  --config              Run node configuration audit
  --targets FILE        File containing list of targets for network scan
  --config-dir DIR      Directory containing node configurations to audit
  --output DIR          Directory to save reports (default: ./reports)
  --verbose             Enable verbose output
    `);
    process.exit(0);
  }
  
  // Parse command line arguments
  const options = {};
  const scanOptions = {};
  
  // Scan types
  let runNetwork = false;
  let runConfig = false;
  let runComprehensive = false;
  
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--comprehensive') {
      runComprehensive = true;
    } else if (args[i] === '--network') {
      runNetwork = true;
    } else if (args[i] === '--config') {
      runConfig = true;
    } else if (args[i] === '--targets' && i + 1 < args.length) {
      scanOptions.targetsFile = args[i + 1];
      i++;
    } else if (args[i] === '--config-dir' && i + 1 < args.length) {
      scanOptions.configDir = args[i + 1];
      i++;
    } else if (args[i] === '--output' && i + 1 < args.length) {
      options.reportPath = args[i + 1];
      i++;
    } else if (args[i] === '--verbose') {
      options.verbose = true;
    }
  }
  
  // Create scanner
  const scanner = new SecurityScanner(options);
  
  // Run requested scans
  if (runComprehensive) {
    scanner.runComprehensiveScan(scanOptions).catch(error => {
      console.error('Comprehensive scan failed:', error);
    });
  } else {
    // Run individual scans
    if (runNetwork && scanOptions.targetsFile) {
      const targets = fs.readFileSync(scanOptions.targetsFile, 'utf8')
        .split('\n')
        .map(t => t.trim())
        .filter(t => t && !t.startsWith('#'));
        
      scanner.networkScanner.scanTargets(targets).catch(error => {
        console.error('Network scan failed:', error);
      });
    }
    
    if (runConfig && scanOptions.configDir) {
      scanner.configAuditor.auditConfigDir(scanOptions.configDir).catch(error => {
        console.error('Configuration audit failed:', error);
      });
    }
  }
}

export default SecurityScanner;
