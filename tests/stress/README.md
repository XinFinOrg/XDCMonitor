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

### Getting Started with Tests

The framework includes a flexible test runner script that allows you to run individual tests or the entire test suite.

#### Using the Test Runner

```bash
# Run all tests
./run-test.sh

# Show help and available options
./run-test.sh --help

# Run all tests in mock mode (no XDC Monitor required)
./run-test.sh --mock

# Run specific test categories
./run-test.sh api               # All API tests
./run-test.sh backend          # All backend tests
./run-test.sh metrics          # All metrics tests
./run-test.sh integration      # Integration tests

# Run specific component tests
./run-test.sh backend blocks    # Only blocks backend tests
./run-test.sh api transaction   # Only transaction API tests

# Combined options
./run-test.sh --mock backend consensus  # Run consensus backend tests in mock mode
```

The test runner creates a timestamped results directory with JSON output files and summary reports for each test.

## Directory Structure (2025-05)

```bash
tests/stress/
├── config.js
├── README.md
├── alerts/
│   ├── alerts-api-stress.js
│   └── alerts-backend-stress.js
├── blocks/
│   ├── blocks-api-stress.js
│   └── blocks-backend-stress.js
├── consensus/
│   ├── consensus-api-stress.js
│   └── consensus-backend-stress.js
├── metrics/
│   ├── dashboard-query-stress.js
│   └── influxdb-write-stress.js
├── rpc/
│   ├── rpc-api-stress.js
│   └── rpc-backend-stress.js
├── transaction/
│   ├── transaction-api-stress.js
│   └── transaction-backend-stress.js
└── utils/
    ├── data-generators.js
    ├── mock-server.js
    └── test-utils.js

# Additional files at the root level
├── run-test.sh            # Flexible test runner script
```

- Each component has its own subfolder with both API and backend processing tests
- Shared utilities are centralized in the `utils` directory
- Backend tests now use true Direct Module Testing by directly importing the actual modules
- Metrics tests in dedicated `metrics` directory
- Results are organized in a hierarchical directory structure

---

### Testing Modes

The framework supports three different modes of operation:

#### 1. Live API Mode

This mode tests against a live XDC Monitor instance using HTTP API endpoints:

```bash
# Using the test runner
./run-test.sh api

# Manual execution
k6 run tests/stress/rpc/rpc-api-stress.js
```

To run with custom options:

```bash
k6 run --vus 50 --duration 10m tests/stress/transaction/transaction-api-stress.js
```

#### 2. True Direct Module Testing Mode

Backend tests now use true direct module testing, which directly imports and uses the actual monitoring modules without requiring API endpoints:

```bash
# Using the test runner
./run-test.sh backend

# Manual execution
k6 run tests/stress/blocks/blocks-backend-stress.js
```

This mode:

- Directly imports the actual service modules from the main codebase
- Properly initializes necessary services like ConfigService, LoggerService, and others
- Eliminates HTTP API dependencies for backend tests
- Tests the actual implementation of the monitoring services
- Provides accurate and meaningful performance metrics
- Can be used to identify bottlenecks in specific modules

#### 3. Mock Response Mode

All tests can also be run in mock mode as an alternative to direct module testing:

```bash
# Using the test runner
./run-test.sh --mock

# Manual execution
k6 run -e MOCK_MODE=true tests/stress/full-pipeline-stress.js
```

Mock mode simulates fixed API responses for all endpoints, allowing you to:

- Test the stress testing framework itself
- Run tests in CI/CD pipelines without dependencies
- Get consistent results for benchmarking

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

### Utility Modules

These modules in the `utils` directory provide support for the stress testing framework:

- **data-generators.js**: Utilities for generating realistic test data
- **mock-server.js**: Provides mock responses when tests are run in mock mode
- **test-utils.js**: Common utilities and helper functions for tests

### API Endpoint Tests

These tests focus on HTTP API performance under high client load:

#### RPC API Tests

```bash
k6 run tests/stress/rpc/rpc-api-stress.js
```

#### Transaction API Tests

```bash
k6 run tests/stress/transaction/transaction-api-stress.js
```

#### Blocks API Tests

```bash
k6 run tests/stress/blocks/blocks-api-stress.js
```

#### Consensus API Tests

```bash
k6 run tests/stress/consensus/consensus-api-stress.js
```

#### Alerts API Tests

```bash
k6 run tests/stress/alerts/alerts-api-stress.js
```

### Backend Processing Tests

These tests focus on the system's ability to handle high blockchain activity:

#### RPC Backend Tests

```bash
k6 run tests/stress/rpc/rpc-backend-stress.js
```

#### Transaction Backend Tests

```bash
k6 run tests/stress/transaction/transaction-backend-stress.js
```

#### Blocks Backend Tests

```bash
k6 run tests/stress/blocks/blocks-backend-stress.js
```

#### Consensus Backend Tests

```bash
k6 run tests/stress/consensus/consensus-backend-stress.js
```

#### Alerts Backend Tests

```bash
k6 run tests/stress/alerts/alerts-backend-stress.js
```

### Metrics System Tests

#### InfluxDB Write Performance

```bash
k6 run tests/stress/metrics/influxdb-write-stress.js
```

#### Dashboard Query Performance

```bash
k6 run tests/stress/metrics/dashboard-query-stress.js
```

### Integration Tests

Integration tests that exercise the entire monitoring stack are planned for future development. Currently, all components are tested individually through their respective API and backend tests.

These tests will be implemented as part of future development.

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

### Shared Utilities

The framework includes shared utilities to reduce code duplication:

- **test-utils.js**: Common testing functions like API calls and validation
- **data-generators.js**: Centralized test data generation
- **mock-server.js**: Mock server implementation for testing without a live application

These utilities ensure consistent behavior across all tests and make maintenance easier.

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
