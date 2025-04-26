# XDC Monitor Stress Testing Framework

This directory contains the full stress test suite for the XDC Network Monitor system. These tests validate the system's performance, reliability, and scalability under realistic, high-load blockchain conditions.

> **Multi-Chain Design:**
>
> - Supports both Testnet and Mainnet via a centralized `CHAINS` configuration array.
> - **Testnet-first:** By default, only Testnet (chainId 51) is enabled to ensure safety and avoid impacting Mainnet. Mainnet can be enabled by toggling a flag in the configuration.
> - All test components (RPC, Transactions, Blocks, Consensus, Alerts) are chain-aware and metrics are tagged by chain/network/component.

## Framework Overview

The stress testing framework implements a multi-tier approach:

1. **Component Testing:** Isolates and stresses individual services (e.g., RPC, Transactions)
2. **Integration Testing:** Validates interactions between related monitoring components (planned)
3. **System Testing:** Exercises the entire monitoring stack under coordinated load (planned)

## Getting Started

### Prerequisites

- [k6](https://grafana.com/docs/k6/latest/set-up/install-k6/) (required)
- Running XDC Monitor instance (local/test environment recommended)
- Node.js (for configuration editing)

### Running Tests

## Directory Structure (2025-04)

```
tests/stress/
├── config.js
├── README.md
├── rpc/
│   └── rpc-endpoint-stress.js
├── transaction/
│   └── transaction-processing-stress.js
├── blocks/
│   └── blocks-processing-stress.js
├── consensus/
│   └── consensus-monitoring-stress.js
├── alerts/
│   └── alerts-system-stress.js
```

- Each test type is in its own subfolder for clarity and scalability.
- config.js and README.md remain at the root for easy access.

---

To run a specific test:

```bash
k6 run tests/stress/rpc/rpc-endpoint-stress.js
```

To run with custom options:

```bash
k6 run --vus 50 --duration 10m tests/stress/transaction/transaction-processing-stress.js
```

To run all enabled tests, repeat above for each test file. All tests will automatically run against all enabled chains in the configuration.

---

## How to Enable Mainnet or Custom Chains

Edit `config.js` in this directory. Example:

```javascript
export const CHAINS = [
  {
    enabled: true, // Enable/disable Testnet
    chainId: 51,
    name: 'Testnet',
    endpoints: [
      /* Testnet RPC endpoints */
    ],
  },
  {
    enabled: false, // Enable/disable Mainnet
    chainId: 50,
    name: 'Mainnet',
    endpoints: [
      /* Mainnet RPC endpoints */
    ],
  },
];
```

- **To enable Mainnet:** Set `enabled: true` for the Mainnet entry.
- **Safety:** Only enable Mainnet after Testnet validation to avoid production impact.
- **You can add custom chains** by extending the `CHAINS` array.

## Test Suite

The following stress tests are included and run against all enabled chains:

### RPC Endpoint Monitoring

- High endpoint count and concurrency
- Simulated endpoint failures
- Response time and error handling under load
- Chain-specific metric tagging

```bash
k6 run tests/stress/rpc-endpoint-stress.js
```

### Transaction Processing

- Mixed transaction types (transfers, contract deployments)
- High throughput and failure simulation
- Processing time and error measurement
- Tagged metrics by chain, network, and transaction type

```bash
k6 run tests/stress/transaction-processing-stress.js
```

### Alert System

- Alert storm simulation with varying severity levels
- Concurrent alert generation and delivery testing
- **Alerting Latency Under Load**: Measures if alerts are delivered within SLAs during extreme conditions
- Critical alert prioritization verification
- End-to-end alert latency measurement from detection to delivery
- Chain-specific alert metrics with severity tagging

```bash
k6 run tests/stress/alerts/alerts-system-stress.js
```

---

## Configuration

The `config.js` file contains shared configuration for all stress tests:

- Chain definitions with enable/disable flags
- Test stages (quick, standard, extended, endurance)
- Threshold presets for different test types
- API endpoint definitions
- Utility functions for test scenarios

### Chain Configuration Example

```javascript
export const CHAINS = [
  {
    enabled: true, // Enable/disable Testnet testing
    chainId: 51,
    name: 'Testnet',
    endpoints: [
      /* Testnet RPC endpoints */
    ],
  },
  {
    enabled: false, // Enable/disable Mainnet testing
    chainId: 50,
    name: 'Mainnet',
    endpoints: [
      /* Mainnet RPC endpoints */
    ],
  },
];
```

To enable Mainnet testing, set `enabled: true` for the Mainnet entry.

---

## Test Profiles

The framework includes several predefined test profiles:

- **Quick:** Short tests for development (2 minutes)
- **Standard:** Normal test suite (10 minutes)
- **Extended:** Thorough validation (30 minutes)
- **Endurance:** Long-running stability tests (2+ hours)

---

## Metrics

Each test collects and reports the following metrics (tagged by chain/network/component):

- Response times (min, max, p95, p99)
- Error rates
- Request counts
- Custom metrics for each component

Metrics are output by k6 and can be integrated with Grafana dashboards for analysis.

---

## Adding New Tests

1. Create a new JavaScript file in `tests/stress`
2. Import the shared configuration from `config.js`
3. Define test options, scenarios, and custom metrics
4. Implement the default function for k6
5. Add documentation for your test to this README

---

## Future Enhancements

Planned additions:

- Block processing stress tests
- Consensus monitoring stress tests
- Alert system load testing
- Metrics collection performance testing
- Database pressure testing
- Long-duration stability tests
- CI/CD integration for automated stress testing

---

## Best Practices

- Always run tests in an isolated environment (never on production Mainnet unless explicitly intended)
- Start with low load and gradually increase
- Monitor system resources (CPU, memory, network, disk) during tests
- Review metrics after each run to identify bottlenecks
- Fix issues and retest to validate improvements

---

For questions, refer to the design and long-term docs, or contact the XDC Monitor engineering team.

## Test Suite

The framework includes the following tests that run against all enabled chains in the configuration:

### RPC Endpoint Monitoring

Tests the system's ability to monitor multiple RPC endpoints under load:

- High endpoint count testing
- Concurrent endpoint failures
- Response time under load
- Error handling
- Multi-chain support with chain-specific metrics

```bash
k6 run tests/stress/rpc-endpoint-stress.js
```

### Transaction Processing

Tests transaction monitoring capabilities under high volume:

- Mixed transaction types (transfers and contract deployments)
- High transaction throughput
- Failed transaction handling
- Processing time measurement
- Tagged metrics by chain, network, and transaction type

```bash
k6 run tests/stress/transaction-processing-stress.js
```

## Configuration

The `config.js` file contains shared configuration for all stress tests:

- Chain definitions with enable/disable flags
- Test stages (quick, standard, extended, endurance)
- Threshold presets for different test types
- API endpoint definitions
- Utility functions for test scenarios

### Chain Configuration

The CHAINS array allows you to enable or disable specific chains for testing:

```javascript
export const CHAINS = [
  {
    enabled: true, // Enable/disable Testnet testing
    chainId: 51,
    name: 'Testnet',
    endpoints: [
      /* Testnet RPC endpoints */
    ],
  },
  {
    enabled: false, // Enable/disable Mainnet testing
    chainId: 50,
    name: 'Mainnet',
    endpoints: [
      /* Mainnet RPC endpoints */
    ],
  },
];
```

To enable Mainnet testing, simply set `enabled: true` for the Mainnet entry.

## Test Profiles

The framework includes several predefined test profiles:

- **Quick**: Short tests for development (2 minutes)
- **Standard**: Normal test suite (10 minutes)
- **Extended**: Thorough validation (30 minutes)
- **Endurance**: Long-running stability tests (2+ hours)

## Metrics

Each test collects and reports the following metrics:

- Response times (min, max, p95, p99)
- Error rates
- Request counts
- Custom metrics specific to each component

## Adding New Tests

To add a new stress test:

1. Create a new JavaScript file in the `tests/stress` directory
2. Import the shared configuration from `config.js`
3. Define test options, scenarios, and custom metrics
4. Implement the default function that k6 will execute
5. Add documentation to this README

## Future Enhancements

Planned additions to the stress testing framework:

- Block processing stress tests
- Consensus monitoring stress tests
- Alert system load testing
- Metrics collection performance testing
- Database pressure testing
- Long-duration stability tests
- CI/CD integration for automated stress testing

## Best Practices

- Run tests in an isolated environment to avoid impacting production
- Start with lower load and gradually increase to find breaking points
- Monitor system resources during tests (CPU, memory, network, disk)
- Review metrics after each test run to identify bottlenecks
- Fix issues and retest to validate improvements
