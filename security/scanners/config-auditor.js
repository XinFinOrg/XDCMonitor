/**
 * XDC Node Configuration Auditor
 * 
 * This scanner audits XDC node configuration files against security best practices.
 * It uses rules defined in ../config/audit-rules.yaml to identify security misconfigurations.
 */

import fs from 'fs';
import yaml from 'js-yaml';
import path from 'path';
import { SCAN_CONFIG } from '../config/constants.js';

class ConfigAuditor {
  constructor(options = {}) {
    this.options = {
      reportPath: SCAN_CONFIG.DEFAULT_REPORT_PATH,
      rulesFile: path.join(__dirname, '../config/audit-rules.yaml'),
      verbose: false,
      ...options
    };
    
    this.rules = this.loadRules();
    this.findings = [];
    this.configsAudited = 0;
    
    // Ensure reports directory exists
    if (!fs.existsSync(this.options.reportPath)) {
      fs.mkdirSync(this.options.reportPath, { recursive: true });
    }
  }
  
  /**
   * Load audit rules from YAML file
   */
  loadRules() {
    try {
      const rulesContent = fs.readFileSync(this.options.rulesFile, 'utf8');
      const rules = yaml.load(rulesContent);
      
      if (!rules || !rules.rules) {
        throw new Error('Invalid rules format: missing "rules" section');
      }
      
      if (this.options.verbose) {
        console.log(`Loaded ${Object.keys(rules.rules).length} rule categories`);
      }
      
      return rules.rules;
    } catch (error) {
      console.error(`Error loading rules: ${error.message}`);
      return {};
    }
  }
  
  /**
   * Audit a node configuration file
   * @param {string} configFile - Path to configuration file
   */
  async auditConfig(configFile) {
    console.log(`Auditing configuration file: ${configFile}`);
    this.configsAudited++;
    
    // Parse the configuration file based on its type
    const config = this.parseConfigFile(configFile);
    if (!config) {
      console.error(`Failed to parse configuration file: ${configFile}`);
      return null;
    }
    
    // Flatten the configuration for easier rule evaluation
    const flatConfig = this.flattenConfig(config);
    
    // Apply rules to the configuration
    const findings = this.applyRules(flatConfig, configFile);
    
    // Save findings
    this.findings.push(...findings);
    
    // Return the results
    const result = {
      file: configFile,
      timestamp: new Date().toISOString(),
      findings
    };
    
    return result;
  }
  
  /**
   * Parse a configuration file based on its type
   * @param {string} configFile - Path to configuration file
   */
  parseConfigFile(configFile) {
    const ext = path.extname(configFile).toLowerCase();
    const content = fs.readFileSync(configFile, 'utf8');
    
    try {
      switch (ext) {
        case '.json':
          return JSON.parse(content);
        case '.yaml':
        case '.yml':
          return yaml.load(content);
        case '.toml':
          // Simple TOML-like parsing (not comprehensive)
          return this.parseToml(content);
        case '.conf':
        case '.cfg':
        case '':  // No extension
          // Try to parse as command line arguments
          return this.parseCommandLine(content);
        default:
          console.warn(`Unsupported file type: ${ext}`);
          return null;
      }
    } catch (error) {
      console.error(`Error parsing ${configFile}: ${error.message}`);
      return null;
    }
  }
  
  /**
   * Simple TOML-like parsing (not a full TOML parser)
   * @param {string} content - TOML content
   */
  parseToml(content) {
    const result = {};
    let currentSection = result;
    
    const lines = content.split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      
      // Skip comments and empty lines
      if (trimmed.startsWith('#') || trimmed === '') {
        continue;
      }
      
      // Section header
      if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
        const sectionName = trimmed.substring(1, trimmed.length - 1);
        const sections = sectionName.split('.');
        
        let current = result;
        for (let i = 0; i < sections.length; i++) {
          const section = sections[i];
          if (!current[section]) {
            current[section] = {};
          }
          current = current[section];
        }
        
        currentSection = current;
        continue;
      }
      
      // Key-value pair
      const eqIndex = trimmed.indexOf('=');
      if (eqIndex > 0) {
        const key = trimmed.substring(0, eqIndex).trim();
        let value = trimmed.substring(eqIndex + 1).trim();
        
        // Try to parse the value
        if (value.startsWith('"') && value.endsWith('"')) {
          value = value.substring(1, value.length - 1);
        } else if (value === 'true') {
          value = true;
        } else if (value === 'false') {
          value = false;
        } else if (!isNaN(value)) {
          value = Number(value);
        }
        
        currentSection[key] = value;
      }
    }
    
    return result;
  }
  
  /**
   * Parse command line arguments format
   * @param {string} content - Command line content
   */
  parseCommandLine(content) {
    const result = {};
    
    const lines = content.split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      
      // Skip comments and empty lines
      if (trimmed.startsWith('#') || trimmed === '') {
        continue;
      }
      
      // Try to match command line arguments
      const args = trimmed.split(/\s+/);
      for (let i = 0; i < args.length; i++) {
        const arg = args[i];
        
        // Check for --key=value or --key value format
        if (arg.startsWith('--')) {
          const key = arg.substring(2);
          
          if (key.includes('=')) {
            const [keyName, value] = key.split('=', 2);
            this.setNestedValue(result, keyName, this.parseValue(value));
          } else if (i + 1 < args.length && !args[i + 1].startsWith('--')) {
            this.setNestedValue(result, key, this.parseValue(args[i + 1]));
            i++;
          } else {
            this.setNestedValue(result, key, true);
          }
        }
      }
    }
    
    return result;
  }
  
  /**
   * Parse a string value into an appropriate type
   * @param {string} value - String value
   */
  parseValue(value) {
    if (value === 'true') return true;
    if (value === 'false') return false;
    if (!isNaN(value)) return Number(value);
    return value;
  }
  
  /**
   * Set a nested value in an object using dot notation
   * @param {Object} obj - Target object
   * @param {string} key - Key in dot notation (e.g., 'rpc.http.enabled')
   * @param {any} value - Value to set
   */
  setNestedValue(obj, key, value) {
    const parts = key.split('.');
    let current = obj;
    
    for (let i = 0; i < parts.length - 1; i++) {
      const part = parts[i];
      if (!current[part]) {
        current[part] = {};
      }
      current = current[part];
    }
    
    current[parts[parts.length - 1]] = value;
  }
  
  /**
   * Flatten a nested configuration object into dot notation
   * @param {Object} config - Nested configuration object
   * @param {string} prefix - Prefix for keys
   * @returns {Object} - Flattened configuration
   */
  flattenConfig(config, prefix = '') {
    const result = {};
    
    for (const [key, value] of Object.entries(config)) {
      const newKey = prefix ? `${prefix}.${key}` : key;
      
      if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
        Object.assign(result, this.flattenConfig(value, newKey));
      } else {
        result[newKey] = value;
      }
    }
    
    return result;
  }
  
  /**
   * Apply rules to a flattened configuration
   * @param {Object} config - Flattened configuration
   * @param {string} configFile - Path to configuration file
   * @returns {Array} - Findings
   */
  applyRules(config, configFile) {
    const findings = [];
    
    // Apply each rule category
    for (const [category, rules] of Object.entries(this.rules)) {
      for (const rule of rules) {
        const { name, description, severity, check, recommendation } = rule;
        
        // Skip rules without checks
        if (!check || !check.condition) {
          continue;
        }
        
        // Check if condition applies to this configuration
        if (this.evaluateCondition(check.condition, config)) {
          findings.push({
            rule: name,
            category,
            description,
            severity: this.mapSeverity(severity),
            recommendation,
            details: {
              condition: check.condition,
              file: configFile
            }
          });
        }
      }
    }
    
    return findings;
  }
  
  /**
   * Evaluate a rule condition against a configuration
   * @param {string} condition - Rule condition
   * @param {Object} config - Flattened configuration
   * @returns {boolean} - True if condition is met
   */
  evaluateCondition(condition, config) {
    // Replace config values in the condition with their actual values
    let evalCondition = condition;
    
    // Extract all config keys mentioned in the condition
    const configKeys = condition.match(/[\w.]+/g) || [];
    
    for (const key of configKeys) {
      // Skip if not a valid config key
      if (!key || key === 'true' || key === 'false' || !isNaN(key)) {
        continue;
      }
      
      // Only replace full key references (not partial matches)
      const regex = new RegExp(`\\b${key}\\b`, 'g');
      
      if (config[key] !== undefined) {
        // Convert value to proper JavaScript literal
        let value = config[key];
        if (typeof value === 'string') {
          value = `"${value}"`;
        } else if (value === null) {
          value = 'null';
        }
        
        evalCondition = evalCondition.replace(regex, value);
      } else if (key.includes('.')) {
        // Key not found in flattened config, replace with undefined
        evalCondition = evalCondition.replace(regex, 'undefined');
      }
    }
    
    // Add helper functions for complex conditions
    const contains = (str, substr) => str && str.includes(substr);
    
    // Replace contains operator
    evalCondition = evalCondition.replace(/(\w+)\s+contains\s+/g, 'contains($1, ');
    
    // Try to evaluate the condition
    try {
      return eval(evalCondition);
    } catch (error) {
      console.error(`Error evaluating condition "${condition}": ${error.message}`);
      console.error(`Processed condition: ${evalCondition}`);
      return false;
    }
  }
  
  /**
   * Map severity strings to numeric values
   * @param {string} severity - Severity string
   * @returns {number} - Severity value
   */
  mapSeverity(severity) {
    switch (severity.toLowerCase()) {
      case 'critical':
        return SCAN_CONFIG.SEVERITY_LEVELS.CRITICAL;
      case 'high':
        return SCAN_CONFIG.SEVERITY_LEVELS.HIGH;
      case 'medium':
        return SCAN_CONFIG.SEVERITY_LEVELS.MEDIUM;
      case 'low':
        return SCAN_CONFIG.SEVERITY_LEVELS.LOW;
      default:
        return SCAN_CONFIG.SEVERITY_LEVELS.INFO;
    }
  }
  
  /**
   * Audit a directory containing configuration files
   * @param {string} configDir - Directory containing configuration files
   */
  async auditConfigDir(configDir) {
    console.log(`Auditing configuration directory: ${configDir}`);
    
    if (!fs.existsSync(configDir)) {
      throw new Error(`Directory not found: ${configDir}`);
    }
    
    const startTime = Date.now();
    const configFiles = this.findConfigFiles(configDir);
    
    console.log(`Found ${configFiles.length} configuration files`);
    
    const results = [];
    
    for (const file of configFiles) {
      try {
        const result = await this.auditConfig(file);
        if (result) {
          results.push(result);
        }
      } catch (error) {
        console.error(`Error auditing ${file}: ${error.message}`);
      }
    }
    
    const scanTime = ((Date.now() - startTime) / 1000).toFixed(2);
    console.log(`Audit complete! Audited ${this.configsAudited} config files in ${scanTime}s`);
    console.log(`Found ${this.findings.length} security findings`);
    
    this.saveReport(results);
    return results;
  }
  
  /**
   * Find configuration files in a directory (recursive)
   * @param {string} dir - Directory to search
   * @returns {Array<string>} - List of configuration file paths
   */
  findConfigFiles(dir) {
    const configExtensions = ['.json', '.yaml', '.yml', '.toml', '.conf', '.cfg'];
    const configNames = ['config', 'settings', 'xdc', 'node'];
    const files = [];
    
    function traverse(currentDir) {
      const entries = fs.readdirSync(currentDir, { withFileTypes: true });
      
      for (const entry of entries) {
        const fullPath = path.join(currentDir, entry.name);
        
        if (entry.isDirectory()) {
          traverse(fullPath);
        } else if (entry.isFile()) {
          const ext = path.extname(entry.name).toLowerCase();
          const baseName = path.basename(entry.name, ext).toLowerCase();
          
          if (configExtensions.includes(ext) || configNames.includes(baseName)) {
            files.push(fullPath);
          }
        }
      }
    }
    
    traverse(dir);
    return files;
  }
  
  /**
   * Save audit results to a JSON report file
   * @param {Array} results - Audit results
   */
  saveReport(results) {
    const timestamp = new Date().toISOString().replace(/:/g, '-');
    const reportPath = path.join(this.options.reportPath, `config-audit-${timestamp}.json`);
    
    // Calculate statistics
    const criticalFindings = this.findings.filter(f => f.severity === SCAN_CONFIG.SEVERITY_LEVELS.CRITICAL).length;
    const highFindings = this.findings.filter(f => f.severity === SCAN_CONFIG.SEVERITY_LEVELS.HIGH).length;
    const mediumFindings = this.findings.filter(f => f.severity === SCAN_CONFIG.SEVERITY_LEVELS.MEDIUM).length;
    const lowFindings = this.findings.filter(f => f.severity === SCAN_CONFIG.SEVERITY_LEVELS.LOW).length;
    
    const report = {
      timestamp,
      summary: {
        configsAudited: this.configsAudited,
        totalFindings: this.findings.length,
        criticalFindings,
        highFindings,
        mediumFindings,
        lowFindings
      },
      results
    };
    
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
    console.log(`Report saved to: ${reportPath}`);
    
    return reportPath;
  }
}

// Allow direct execution from command line
// In ES modules, there's no direct equivalent to require.main === module
if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  
  if (args.length === 0 || args.includes('--help')) {
    console.log(`
XDC Node Configuration Auditor

Usage:
  node config-auditor.js --config FILE [options]
  node config-auditor.js --dir DIR [options]

Options:
  --config FILE        Configuration file to audit
  --dir DIR            Directory containing configuration files to audit
  --rules FILE         Custom rules file (default: ../config/audit-rules.yaml)
  --output DIR         Directory to save reports (default: ../reports)
  --verbose            Enable verbose output
    `);
    process.exit(0);
  }
  
  // Parse command line arguments
  const options = {};
  let configFile = null;
  let configDir = null;
  
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--config' && i + 1 < args.length) {
      configFile = args[i + 1];
      i++;
    } else if (args[i] === '--dir' && i + 1 < args.length) {
      configDir = args[i + 1];
      i++;
    } else if (args[i] === '--rules' && i + 1 < args.length) {
      options.rulesFile = args[i + 1];
      i++;
    } else if (args[i] === '--output' && i + 1 < args.length) {
      options.reportPath = args[i + 1];
      i++;
    } else if (args[i] === '--verbose') {
      options.verbose = true;
    }
  }
  
  const auditor = new ConfigAuditor(options);
  
  if (configFile) {
    auditor.auditConfig(configFile).catch(error => {
      console.error('Audit failed:', error);
    });
  } else if (configDir) {
    auditor.auditConfigDir(configDir).catch(error => {
      console.error('Audit failed:', error);
    });
  } else {
    console.error('Error: either --config or --dir option is required');
    process.exit(1);
  }
}

export default ConfigAuditor;
