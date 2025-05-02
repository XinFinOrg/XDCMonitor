# XDCMonitor Security Module

The Security Module provides continuous monitoring and threat detection for XDC Network infrastructure components. It performs automated security assessments, records metrics, and generates alerts for potential vulnerabilities.

## Architecture Overview

The security module follows a metrics-based monitoring approach consistent with other XDCMonitor components:

```ascii
┌─────────────────────┐      ┌─────────────────┐
│ SecurityController  │◄────►│ SecurityService │
└─────────────────────┘      └────────┬────────┘
                                     │
                                     ▼
                  ┌───────────────────────────────────┐
                  │                                   │
        ┌─────────▼──────────┐           ┌───────────▼────────────┐
        │ NetworkScanService │           │ ConfigAuditorService   │
        └────────────────────┘           └────────────────────────┘

                        │                           │
                        ▼                           ▼
                   ┌─────────────────────────────────────┐
                   │ MetricsService (Security Metrics)   │
                   └───────────────────┬─────────────────┘
                                       │
                                       ▼
                                 ┌──────────────┐
                                 │  InfluxDB    │
                                 └──────────────┘

                                       │
                                       ▼
                                 ┌──────────────┐
                                 │ AlertService │
                                 └──────────────┘
```

## Core Components

### SecurityService

Central orchestration service that:

- Coordinates security scans (scheduled or on-demand)
- Processes scan results and updates security metrics
- Evaluates severity levels and manages alerting
- Provides API endpoints for security status and vulnerability data

### NetworkScannerService

Identifies infrastructure-level vulnerabilities:

- Scans network endpoints for exposed services
- Detects unsafe API configurations and unauthorized access
- Checks for outdated software and known vulnerabilities
- Evaluates timeout and response patterns for anomalies

### ConfigAuditorService

Reviews configuration files for security issues:

- Identifies weak authentication settings
- Detects overly permissive network access rules
- Validates secure communication configurations
- Finds resource configuration issues (e.g., no rate limiting)

## Key Features

- **Real-time Monitoring**: Continuous integration with metrics system
- **Scheduled Scanning**: Weekly automatic security assessment (customizable)
- **Vulnerability Tracking**: Classification and prioritization of issues
- **Intelligent Alerting**: Severity-based notification system
- **API Access**: Endpoints for triggering scans and retrieving vulnerability data

## Metrics & Alerting

### Security Metrics

All security metrics are recorded in InfluxDB via the MetricsService:

- `security_scan`: Overall scan summary with counts of issues by severity
- `security_network_scan`: Network scan-specific metrics
- `security_vulnerability`: Distribution of vulnerability types
- `security_config_audit`: Configuration audit metrics
- `security_config_finding`: Distribution of configuration finding types

### Security Alerts

Alerts are generated based on severity thresholds:

- **Critical issues**: Immediate high-priority alerts
- **High severity issues**: Warning alerts with details
- **Medium/Low issues**: Recorded but don't trigger alerts by default

## API Endpoints

All endpoints available under `/api/security`:

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/status` | GET | Get current security posture status |
| `/scan` | POST | Trigger a comprehensive security scan |
| `/current-scan` | GET | Get details of the latest scan |
| `/vulnerabilities` | GET | Get all detected vulnerabilities (optional filtering) |
| `/scan/network` | POST | Run only a network security scan |
| `/scan/config` | POST | Run only a configuration audit |

## Configuration

The security module is configured through environment variables and the ConfigService:

- `securityConfigDir`: Directory to scan for configuration files (default: './config')
- `securityScanMainnet`: Whether to include mainnet nodes in scans (default: false)
- `securityScanInterval`: Cron expression for scan frequency (default: weekly)

## Integration

The security module integrates with:
- **Metrics System**: Records all security-related measurements
- **Alert System**: Generates notifications for critical issues
- **Config Service**: Retrieves system configuration settings

## Usage Examples

### Triggering a scan via API

```bash
curl -X POST http://localhost:3000/api/security/scan
```

### Getting vulnerability data

```bash
curl http://localhost:3000/api/security/vulnerabilities?severity=critical
```

### Configuration Audit Only

```bash
curl -X POST http://localhost:3000/api/security/scan/config \
  -H "Content-Type: application/json" \
  -d '{"configDir": "/path/to/configs"}'
```
