# XDC Network Security Scanner

This directory contains security scanning tools for the XDC Network Monitor system and XDC blockchain nodes.

## Overview

The security scanner system provides:

1. **Network Security Scanning**: Detects exposed RPC endpoints and potential vulnerabilities
2. **Node Configuration Auditing**: Ensures node configurations follow security best practices
3. **Runtime Monitoring**: Detects suspicious activities during node operation

## Directory Structure

```
security/
├── scanners/       # Security scanning modules
├── config/         # Configuration files and rules
└── reports/        # Output for scan reports (created at runtime)
```

## Usage

Each scanner can be run independently or as part of an automated pipeline:

```bash
# Run network security scan
node scanners/network-scanner.js --targets config/targets.txt

# Audit node configuration
node scanners/config-auditor.js --config /path/to/node/config

# Run comprehensive security scan
npm run comprehensive
```

## Modern JavaScript

The security scanner uses modern ES modules syntax:

- `import/export` statements instead of CommonJS `require()`
- Package.json configured with `"type": "module"`
- Proper ES module path handling with `import.meta.url` and `fileURLToPath`

## Multi-Chain Support

The security scanning system supports both Testnet and Mainnet networks:

- **Testnet-first approach**: Testnet enabled by default for safety
- **Mainnet disabled**: Empty endpoints array prevents accidental Mainnet scanning
- **Easy toggling**: Add endpoints to enable Mainnet scanning when needed

## Integration with XDC Monitor

The security scanning system integrates with the XDC Monitor alerting system, enabling:

- Automated weekly security scans
- Real-time notifications for critical vulnerabilities
- Security metrics dashboard

## Documentation

For detailed documentation on each scanner, refer to the files in the `docs/` directory.
