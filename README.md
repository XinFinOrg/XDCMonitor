# XDC Network Monitor

A comprehensive Node.js-based monitoring system for the XDC Network. This application provides real-time monitoring of blockchain infrastructure with a focus on RPC endpoint monitoring, port monitoring, block propagation, alerting, and visualization.

## Features

- **Dynamic RPC Selection**: Intelligent selection of optimal RPC endpoints based on real-time health metrics
  - Automatic quality tier classification (HIGH, MEDIUM, LOW, UNKNOWN)
  - Multi-factor scoring algorithm considering latency, success rates, and sync status
  - Seamless failover with minimum switch intervals to prevent rapid toggling
  - Block height sync monitoring and lag detection
  - Real-time endpoint health tracking with exponential decay weighting
- **RPC URL Monitoring**: Mainnet and Testnet endpoint monitoring, downtime detection, latency measurement, peer count analysis
- **Multi-RPC Monitoring**: Monitor multiple endpoints simultaneously, compare response times, adaptive monitoring frequency
- **Advanced Connection Point Checks**: HTTP/HTTPS port checks, WebSocket port checks, subscription testing, batch processing
- **Intelligent Endpoint Management**:
  - Priority-based recovery detection for faster reaction to endpoint issues
  - Dynamic frequency adjustment based on endpoint health
  - Peer count monitoring with dynamic baselines and anomaly detection
  - Multi-method verification with primary and fallback strategies
  - RPC sync blocks lag detection with configurable thresholds (warning at 100 blocks, critical at 1000 blocks)
  - Intelligent alert aggregation for multiple lagging endpoints
- **Block Propagation Monitoring**: Block time tracking, slow block detection
- **Transaction Monitoring**: Automated transaction testing, smart contract deployment testing
- **Consensus Monitoring**: Masternode performance tracking, epoch transitions, validator penalties
- **Alert System**: Dashboard alerts, Telegram notifications, webhook notifications
  - Adaptive throttling to reduce noise during widespread issues
  - Alert aggregation for related problems
- **Metrics Collection**: InfluxDB time-series database, Grafana dashboards

## Dynamic RPC Selection System

The XDC Monitor features an advanced dynamic RPC selection system that automatically chooses the best available RPC endpoints for optimal blockchain service reliability.

### How It Works

1. **Real-Time Health Monitoring**: Continuously monitors all configured RPC endpoints for:

   - Response latency and reliability
   - Block height synchronization status
   - Success rates with exponential decay (recent performance weighted more heavily)
   - Network connectivity and peer count

2. **Quality Tier Classification**: Automatically categorizes endpoints into quality tiers:

   - **HIGH (Tier 3)**: Consistently reliable, low latency endpoints
   - **MEDIUM (Tier 2)**: Generally reliable with occasional issues
   - **LOW (Tier 1)**: Less reliable or higher latency endpoints
   - **UNKNOWN (Tier 0)**: Newly discovered or not yet evaluated endpoints

3. **Multi-Factor Scoring**: Uses a weighted algorithm to score endpoints based on:

   - **Latency Score (40%)**: Lower latency is better
   - **Success Rate (30%)**: Higher success rate is better
   - **Sync Score (20%)**: How well the endpoint keeps up with the network
   - **Quality Tier Bonus (10%)**: Preference for higher-tier endpoints

4. **Intelligent Switching**: Automatically switches to better endpoints when:
   - Current primary endpoint has issues (down, high latency, out of sync)
   - A significantly better endpoint becomes available
   - Minimum switch interval (5 minutes) has passed to prevent rapid toggling

### Configuration

The system works automatically without configuration, but you can monitor its operation through API endpoints:

```bash
# Get health metrics for all RPC endpoints
curl http://your-server:3000/api/monitoring/rpc/health

# Get currently selected primary endpoints
curl http://your-server:3000/api/monitoring/rpc/primary

# Get health metrics for a specific chain
curl http://your-server:3000/api/monitoring/rpc/health/50  # Mainnet
curl http://your-server:3000/api/monitoring/rpc/health/51  # Testnet

# Get overall RPC status
curl http://your-server:3000/api/monitoring/rpc/status
```

### Benefits

- **Self-Healing Infrastructure**: Automatically adapts to network conditions and endpoint issues
- **Optimal Performance**: Always uses the best available endpoint for blockchain operations
- **Reduced Downtime**: Seamless failover when primary endpoints have problems
- **Transparent Operation**: Works behind the scenes without requiring manual intervention
- **Quality-Based Prioritization**: Learns from historical performance to prefer reliable endpoints

## Comprehensive Logging System

The XDC Monitor features an enterprise-grade logging system designed for production environments with comprehensive log management, daily organization, and powerful analysis capabilities.

### Key Features

- **Daily Log Organization**: Logs are organized in daily folders (YYYY-MM-DD format) for intuitive navigation and investigation
- **Winston-Based Service**: Built on Winston logger with multiple transports and automatic rotation
- **Multiple Log Levels**: Support for debug, info, warn, error, and verbose logging with appropriate file segregation
- **Specialized Logging Methods**: Dedicated logging functions for different system components and activities
- **Structured Metadata**: JSON metadata support for detailed, searchable logging information
- **Exception Handling**: Automatic capture of uncaught exceptions and unhandled promise rejections
- **Performance Monitoring**: Built-in latency tracking and performance metrics logging

### Log Organization

#### Daily Structure

```
logs/
├── 2024-01-15/           # Daily folder (YYYY-MM-DD format)
│   ├── combined.log      # All log levels for this day
│   ├── app.log           # Application logs for this day
│   ├── error.log         # Error logs for this day
│   ├── debug.log         # Debug logs (when LOG_LEVEL=debug)
│   ├── exceptions.log    # Uncaught exceptions
│   └── rejections.log    # Promise rejections
└── 2024-01-16/           # Next day's logs
```

#### Benefits of Daily Organization

- **Easy Investigation**: Navigate directly to the day when an issue occurred
- **Natural Cleanup**: Delete entire day folders when logs are no longer needed
- **Better Performance**: Smaller daily files instead of huge rotating files
- **Unlimited Storage**: No file size limits, perfect for high-capacity servers
- **Intuitive Navigation**: Organized the way humans think about time

### Usage

#### Basic Logging

```typescript
import { CustomLoggerService } from '@logging/logger.service';

@Injectable()
export class YourService {
  constructor(private readonly logger: CustomLoggerService) {}

  yourMethod() {
    this.logger.log('General information', 'YourService');
    this.logger.warn('Warning message', 'YourService');
    this.logger.error('Error occurred', undefined, 'YourService');
    this.logger.debug('Debug information', 'YourService');
  }
}
```

#### Specialized Logging Methods

```typescript
// Log RPC activity with latency
this.logger.logRpcActivity('https://rpc.xinfin.network', 'Connection successful', 250);

// Log blockchain activity with metadata
this.logger.logBlockchainActivity(50, 'New block processed', {
  blockNumber: 12345,
  txCount: 45,
});

// Log monitoring activity
this.logger.logMonitoringActivity('RPC_MONITOR', 'Health check completed', {
  endpointsUp: 7,
  endpointsDown: 0,
});

// Log metrics and alerts
this.logger.logMetrics('InfluxDB write completed', { pointsWritten: 100 });
this.logger.logAlert('error', 'RPC_MONITOR', 'Endpoint is down', {
  endpoint: 'https://rpc.example.com',
});
```

### Log Management Scripts

The system includes comprehensive NPM scripts for log management:

#### Viewing Logs

```bash
# View all today's logs in real-time
npm run logs:view

# View specific log types
npm run logs:view-errors       # Today's error logs only
npm run logs:view-app         # Today's app logs only
npm run logs:view-debug       # Today's debug logs only
npm run logs:view-combined    # Today's combined logs only

# View yesterday's logs
npm run logs:view-yesterday

# List all available log days
npm run logs:list-days
```

#### Managing Logs

```bash
# Check total log size and daily breakdown
npm run logs:size

# Archive all daily logs (moves to archive folder)
npm run logs:archive

# Clear all daily logs (permanent deletion)
npm run logs:clear

# Clean up logs older than 30 days
npm run logs:cleanup-old
```

### Configuration

Control logging behavior with environment variables:

```bash
# Set log level (in .env file)
LOG_LEVEL=info    # Default: info, warn, error
LOG_LEVEL=debug   # All levels including debug (creates debug.log)
LOG_LEVEL=error   # Only errors
LOG_LEVEL=warn    # Warnings and errors
LOG_LEVEL=verbose # Everything (most detailed)
```

### Log Analysis

#### Common Analysis Commands

```bash
# Find all errors in today's logs
grep -i "error\|fail\|down" logs/$(date +%Y-%m-%d)/combined.log

# Check RPC endpoint issues
grep -i "rpc.*error\|endpoint.*down" logs/$(date +%Y-%m-%d)/combined.log

# Monitor alert activity
grep "\[ALERT:" logs/$(date +%Y-%m-%d)/combined.log | tail -20

# Check application startup
grep "XDC MONITOR APPLICATION STARTED" logs/$(date +%Y-%m-%d)/combined.log
```

#### Performance Analysis

```bash
# Find performance issues
grep -i "latency\|slow\|timeout" logs/$(date +%Y-%m-%d)/combined.log

# Track specific endpoint performance
grep "rpc.xinfin.network" logs/$(date +%Y-%m-%d)/combined.log | grep "ms"
```

### Integration with Monitoring

The logging system integrates seamlessly with other monitoring components:

- **Alert Integration**: All alerts are automatically logged with structured metadata
- **Performance Tracking**: RPC latency and blockchain operation timing included in logs
- **Error Correlation**: Stack traces and context information for debugging
- **Metrics Logging**: InfluxDB operations and metrics collection logged for troubleshooting

## Architecture

The XDC Monitor has been optimized with a modular, maintainable architecture:

### Core Components

- **Shared Constants**: Configuration values are centralized in the `common/constants` directory
- **Enhanced Queue System**: Resilient job processing with retry, timeout, and prioritization
- **Time-Series Data Management**: Efficient time window data structures for metrics
- **Modular Services**: Clean separation of concerns with specialized service modules
- **Consensus Monitoring**: Specialized monitors for miners, epochs, and rewards
- **Comprehensive Logging System**: Enterprise-grade Winston-based logging with daily organization, multiple transports, and specialized methods

### Performance Optimizations

- **Batched Processing**: Transaction processing uses parallel batching for higher throughput
- **Priority-based Queue**: Critical operations (like mainnet block processing) get priority
- **Efficient Memory Usage**: Time-window data structures automatically clean up old data
- **Smart Error Handling**: Automatic retry with exponential backoff for transient failures
- **Code Optimization**: Helper methods reduce duplication and improve maintainability
- **DRY Principle**: Don't Repeat Yourself approach for alert classification and formatting
- **Sliding Window Data**: Memory-efficient approach for tracking recent state without database overhead
- **Alert Aggregation**: Groups related alerts to reduce notification noise
- **Adaptive Alert Throttling**: Increases throttle time for widespread issues

### Technical Details

- **Framework**: NestJS for enterprise-grade dependency injection and modular architecture
- **Time Series DB**: InfluxDB for efficient storage and querying of time-series metrics
- **Visualization**: Grafana dashboards for real-time monitoring and alerting
- **Container Support**: Docker and Docker Compose for easy deployment and scaling

## Alert System

The XDC Monitor includes a comprehensive alert system to notify you of important network events.

### Alert Types

The system monitors the following conditions:

1. **Average Block Time**

   - Alerts when the average block time over the last 100 blocks exceeds 2.5 seconds
   - Severity: Warning
   - Component: blockchain
   - Threshold: 2.5 seconds

2. **Transaction Errors**

   - Alerts when more than 3 failed transactions are detected across all blocks in a 5-minute period
   - Severity: Warning
   - Component: transactions
   - Threshold: 3 failed transactions in 5 minutes

3. **High Transaction Volume**

   - Alerts when more than 2000 transactions are processed within a 5-minute period
   - Severity: Info
   - Component: transactions
   - Threshold: 2000 transactions per 5 minutes

4. **RPC Response Time**

   - Alerts when an RPC endpoint takes more than 30 seconds to respond
   - Severity: Critical
   - Component: rpc
   - Threshold: 30 seconds (30,000 ms)

5. **Transaction Test Failures**

   - Alerts when test transactions (normal or contract deployment) consistently fail
   - Severity: Warning
   - Component: transactions
   - Threshold: 3 consecutive failures

6. **Test Wallet Balance**

   - Alerts when test wallet balance falls below the required minimum (0.01 XDC)
   - Severity: Warning
   - Component: wallet
   - Threshold: 0.01 XDC

7. **Penalty List Size**

   - Alerts when the validator penalty list exceeds a configured threshold
   - Severity: Warning
   - Component: consensus
   - Threshold: 20 validators

8. **Frequently Penalized Nodes**
   - Alerts when validators appear in the penalty list too frequently
   - Severity: Warning
   - Component: consensus
   - Threshold: Penalized in 70% or more of recent epochs
9. **RPC Sync Blocks Lag**
   - Alerts when RPC endpoints fall behind in block height compared to the network
   - Warning Severity: When endpoints are 100-999 blocks behind
   - Critical Severity: When endpoints are 1000+ blocks behind
   - Component: sync
   - Features intelligent alert aggregation and adaptive throttling to reduce notification noise
   - Uses 1-hour throttling to prevent notification fatigue during prolonged sync issues
10. **High Transaction Failure Rate**

- Alerts when more than 50% of RPC endpoints fail transaction tests
- Severity: Error
- Component: transaction
- Threshold: 50% of RPC endpoints failing
- Includes detailed list of all failing RPC endpoints for quick troubleshooting
- Monitors both normal transactions and contract deployments separately
- Tracks failure rates per network (Mainnet chainId 50, Testnet chainId 51)
- Provides specific endpoint failure information for rapid issue resolution

### Alert Delivery

Alerts are delivered through multiple channels:

1. **Grafana UI**: Dashboard alerts appear in the Grafana UI (controlled by `ENABLE_DASHBOARD_ALERTS`)
2. **Telegram**: Alerts sent to a configured Telegram chat (controlled by `ENABLE_CHAT_NOTIFICATIONS`)
3. **Webhook**: Alerts sent to an external service via webhook (controlled by `ENABLE_CHAT_NOTIFICATIONS` and requires `NOTIFICATION_WEBHOOK_URL`)
4. **Server Logs**: All alerts are logged in the server's logs

### Alert Configuration

Configure alerts in your `.env` file:

```
# Enable/disable alert channels
ENABLE_DASHBOARD_ALERTS=true
ENABLE_CHAT_NOTIFICATIONS=true

# Telegram configuration
TELEGRAM_BOT_TOKEN="your-telegram-bot-token-here"
TELEGRAM_CHAT_ID="your-telegram-chat-id-here"
TELEGRAM_MAINNET_TOPIC_ID="topic-id-for-mainnet-alerts"
TELEGRAM_TESTNET_TOPIC_ID="topic-id-for-testnet-alerts"

# Webhook configuration
NOTIFICATION_WEBHOOK_URL="https://hooks.slack.com/services/XXX/YYY/ZZZ"
```

The system uses these environment variables to control alert behavior:

- `ENABLE_DASHBOARD_ALERTS`: Controls Grafana dashboard alerts
- `ENABLE_CHAT_NOTIFICATIONS`: Controls external notifications (Telegram and webhook)
- `TELEGRAM_BOT_TOKEN` & `TELEGRAM_CHAT_ID`: Required for Telegram notifications
- `NOTIFICATION_WEBHOOK_URL`: URL to send webhook alerts (for Slack, Discord, etc.)

### Comprehensive Testing Framework

The XDC Monitor includes an extensive testing framework for validating alert functionality and simulating various network conditions:

#### Alert Testing Endpoints

```bash
# Test all alerts at once
curl http://your-server:3000/api/testing/trigger-all-alerts

# Test specific alert types
curl http://your-server:3000/api/testing/trigger-alert/block-time
curl http://your-server:3000/api/testing/trigger-alert/tx-errors
curl http://your-server:3000/api/testing/trigger-alert/tx-volume
curl http://your-server:3000/api/testing/trigger-alert/rpc-time

# Manually trigger custom alerts
curl "http://your-server:3000/api/testing/trigger-manual-alert?type=error&title=Custom%20Alert&message=Test%20message&chainId=50"
```

#### Network Simulation Endpoints

```bash
# Simulate slow block times
curl "http://your-server:3000/api/testing/simulate-slow-blocktime?seconds=4"
curl "http://your-server:3000/api/testing/simulate-apothem-blocktime?seconds=4"

# Simulate RPC endpoint issues
curl -X POST "http://your-server:3000/api/testing/simulate-rpc-down?endpoint=https://rpc.example.com"
curl -X POST "http://your-server:3000/api/testing/simulate-rpc-latency?endpoint=https://rpc.example.com&latency=500"
```

#### Telegram Integration Testing

```bash
# Test Telegram topic routing (Mainnet/Testnet/General)
curl http://your-server:3000/api/testing/test-telegram-topics
```

#### Weekly Report Testing

```bash
# Generate weekly report for custom date range
curl "http://your-server:3000/api/testing/generate-weekly-report?startDays=7&endDays=0"

# Get formatted weekly report message (as would be sent to Telegram)
curl "http://your-server:3000/api/testing/weekly-report-message?startDays=7&endDays=0"

# Send weekly report to all configured channels
curl -X POST "http://your-server:3000/api/testing/send-weekly-report?startDays=7&endDays=0"
```

### Testing Alert System

You can test the alert system using these API endpoints:

```bash
# Test all alerts at once
curl http://your-server:3000/api/testing/trigger-all-alerts

# Test specific alert types
curl http://your-server:3000/api/testing/trigger-alert/block-time
curl http://your-server:3000/api/testing/trigger-alert/tx-errors
curl http://your-server:3000/api/testing/trigger-alert/tx-volume
curl http://your-server:3000/api/testing/trigger-alert/rpc-time
```

## CI/CD Pipeline

This project uses GitHub Actions for continuous integration and deployment:

### CI Workflow

The CI workflow consists of three jobs:

1. **Validate**: Builds and tests the application

   - Runs on pushes to `main` and `staging` branches
   - Runs on pull requests to `main` and `staging` branches
   - Checks code, builds the application, and verifies the Docker image

2. **Publish**: Publishes Docker images
   - Triggered only on pushes to `main` and `staging`
   - Publishes to GitHub Container Registry with appropriate tags

### Deployment Workflow

The staging deployment workflow:

- Triggered when pull requests are merged to the `staging` branch
- Deploys the application to the staging server via SSH
- Sets up the environment with proper configuration
- Restarts services using Docker Compose

### Docker Images

The published Docker images can be pulled from GitHub Container Registry:

```bash
# Pull the latest main branch image
docker pull ghcr.io/[organization]/xdc-monitor:main

# Pull a specific commit
docker pull ghcr.io/[organization]/xdc-monitor:sha-abcdef
```

## Prerequisites

- Node.js 16.x or higher
- npm or yarn package manager
- Access to XDC Network RPC endpoints
- Docker and Docker Compose (for full stack deployment)

## Installation

1. Clone the repository:

   ```bash
   git clone https://github.com/yourusername/xdc-monitor.git
   cd xdc-monitor
   ```

2. Install dependencies:

   ```bash
   npm install
   ```

3. Configure the application by creating a `.env` file (see Configuration section)

4. Build the application:
   ```bash
   npm run build
   ```

## Configuration

The project uses environment variables for configuration. Create a `.env` file in the project root with the following variables:

```
# General configuration
BLOCKS_TO_SCAN=10
SCAN_INTERVAL=15

# Monitoring features
ENABLE_RPC_MONITORING=true
ENABLE_PORT_MONITORING=true
ENABLE_BLOCK_MONITORING=true
ENABLE_TRANSACTION_MONITORING=true
ENABLE_CONSENSUS_MONITORING=true
BLOCK_TIME_THRESHOLD=3.0

# Consensus monitoring configuration
CONSENSUS_MONITORING_CHAIN_IDS=50,51
CONSENSUS_SCAN_INTERVAL=15000

# Alert configuration
ENABLE_DASHBOARD_ALERTS=true
ENABLE_CHAT_NOTIFICATIONS=true
NOTIFICATION_WEBHOOK_URL=

# Telegram notification configuration
TELEGRAM_BOT_TOKEN="your-telegram-bot-token-here"
TELEGRAM_CHAT_ID="your-telegram-chat-id-here"
TELEGRAM_MAINNET_TOPIC_ID="topic-id-for-mainnet-alerts"
TELEGRAM_TESTNET_TOPIC_ID="topic-id-for-testnet-alerts"

# Logging configuration
LOG_LEVEL=info

# InfluxDB Configuration
INFLUXDB_URL=http://localhost:8086
INFLUXDB_TOKEN=your-influxdb-token
INFLUXDB_ORG=xdc
INFLUXDB_BUCKET=xdc_metrics
INFLUXDB_ADMIN_USER=admin
INFLUXDB_ADMIN_PASSWORD=secure-password

# internal-node-datasource configuration
INTERNAL_NODE_INFLUXDB_URL=http://xdc-internal-node:8086
INTERNAL_NODE_INFLUXDB_TOKEN=your_actual_token_here


# Grafana Admin Credentials
GRAFANA_ADMIN_USER=admin
GRAFANA_ADMIN_PASSWORD=secure-password

# Transaction monitoring configuration
ENABLE_TRANSACTION_MONITORING=true
MAINNET_TEST_PRIVATE_KEY=your-test-wallet-private-key-for-mainnet
TESTNET_TEST_PRIVATE_KEY=your-test-wallet-private-key-for-testnet
TEST_RECEIVER_ADDRESS_50=0xReceiverAddressForMainnet
TEST_RECEIVER_ADDRESS_51=0xReceiverAddressForTestnet
```

### Webhook Notifications

The `NOTIFICATION_WEBHOOK_URL` configuration allows you to send alert notifications to external services. You can use any webhook-compatible service:

1. **Slack Incoming Webhook**:

   - Create a webhook URL in your Slack workspace (Apps → Create app → Incoming Webhooks)
   - Example: `https://hooks.slack.com/services/T00000000/B00000000/XXXXXXXX`

2. **Discord Webhook**:

   - Create a webhook URL in your Discord server (Channel settings → Integrations → Webhooks)
   - Example: `https://discord.com/api/webhooks/000000000000000000/XXXX`

3. **Microsoft Teams Webhook**:

   - Create a webhook in your Teams channel (... menu → Connectors → Incoming Webhook)

4. **Custom Webhook Endpoint**:
   - Any HTTP endpoint that accepts JSON POST requests with alert data

When configured, the system will POST JSON data containing alert information to this URL whenever monitoring conditions trigger an alert.

## Usage

### Running in Production Mode

```bash
npm run start:prod
```

### Docker Deployment Options

#### Running the Complete Stack

```bash
docker-compose up -d
```

This will start all services:

- XDC Monitor (API and monitoring)
- InfluxDB (metrics storage)
- Grafana (visualization)

#### Running Individual Services

```bash
# Run only InfluxDB
docker-compose up -d influxdb

# Run only Grafana
docker-compose up -d grafana
```

## Using the Helper Script

For convenience, this project includes a helper script to manage various deployment scenarios:

```bash
# Make the script executable (first time only)
chmod +x run.sh

# Show available commands
./run.sh help

# Start the complete stack
./run.sh up

# View logs
./run.sh logs

# Clear influxdb data
./run.sh clear-influxdb

# Rebuild containers (after code changes)
./run.sh rebuild

# Clean up all containers, volumes and networks (fixes Docker issues)
./run.sh clean
```

## API Endpoints

- **Block Status**: `/api/monitoring/block-status` - Current block monitoring information
- **Block Comparison**: `/api/monitoring/block-comparison` - Comparison of block heights across RPCs
- **RPC Status**: `/api/monitoring/rpc-status` - Status of all RPC endpoints
- **WebSocket Status**: `/api/monitoring/websocket-status` - Status of WebSocket connections
- **Transaction Status**: `/api/monitoring/transaction-status` - Status of transaction monitoring
- **Overall Status**: `/api/monitoring/status` - Combined status of all monitoring systems
- **Notifications Test**: `/api/notifications/test` - Test the notification system
- **Telegram Webhook**: `/api/notifications/telegram` - Endpoint for Grafana to send alerts

### Comprehensive Testing Endpoints

The system provides extensive testing capabilities through dedicated API endpoints:

#### Alert Testing Endpoints

- **Trigger All Alerts**: `/api/testing/trigger-all-alerts` - Trigger all implemented alert types for comprehensive testing
- **Trigger Specific Alert**: `/api/testing/trigger-alert/{type}` - Trigger specific alert types (block-time, tx-errors, tx-volume, rpc-time)
- **Trigger Manual Alert**: `/api/testing/trigger-manual-alert?type={type}&title={title}&message={message}&chainId={chainId}` - Create custom alerts with flexible parameters

#### Network Simulation Endpoints

- **Simulate Slow Block Time**: `/api/testing/simulate-slow-blocktime?seconds={seconds}` - Simulate slow block times for Mainnet
- **Simulate Apothem Block Time**: `/api/testing/simulate-apothem-blocktime?seconds={seconds}` - Simulate slow block times for Testnet
- **Simulate RPC Down**: `/api/testing/simulate-rpc-down?endpoint={url}` (POST) - Simulate RPC endpoint downtime
- **Simulate RPC Latency**: `/api/testing/simulate-rpc-latency?endpoint={url}&latency={ms}` (POST) - Simulate high RPC latency

#### Telegram Integration Testing

- **Test Telegram Topics**: `/api/testing/test-telegram-topics` - Test topic-based routing for Mainnet/Testnet/General alerts

#### Weekly Report Testing

- **Generate Weekly Report**: `/api/testing/generate-weekly-report?startDays={days}&endDays={days}` - Generate weekly alert reports for custom date ranges
- **Get Weekly Report Message**: `/api/testing/weekly-report-message?startDays={days}&endDays={days}` - Get formatted weekly report messages
- **Send Weekly Report**: `/api/testing/send-weekly-report?startDays={days}&endDays={days}` (POST) - Generate and send weekly reports to all channels

### Testing Endpoints

- **Trigger Manual Alert**: `/api/testing/trigger-manual-alert?type=error&title=Title&message=Message` - Directly trigger an alert
- **Simulate Slow Block Time**: `/api/testing/simulate-slow-blocktime?seconds=4` - Simulate a slow block time
- **Simulate RPC Down**: `/api/testing/simulate-rpc-down?endpoint=URL` - Simulate an RPC endpoint being down
- **Simulate RPC Latency**: `/api/testing/simulate-rpc-latency?endpoint=URL&latency=500` - Simulate high RPC latency
- **Run Transaction Test**: `/api/testing/run-transaction-test?chainId=50&type=normal` - Manually trigger a transaction test
- **Test Telegram Topics**: `/api/testing/test-telegram-topics` - Test sending alerts to different Telegram topics (Mainnet/Testnet/General)
- **Generate Weekly Report**: `/api/testing/generate-weekly-report?startDays=7&endDays=0` - Generate a detailed weekly alert report as JSON
- **Get Weekly Report Message**: `/api/testing/weekly-report-message?startDays=7&endDays=0` - Get the formatted message that would be sent to Telegram
- **Send Weekly Report**: `/api/testing/send-weekly-report?startDays=7&endDays=0` - Generate and send a weekly report to all configured channels

## Metrics Collected

The application stores the following metrics in InfluxDB:

- `block_height` - Current block height, tagged with `chainId` and `endpoint`
- `transaction_count` - Transaction counts by status, tagged with `status` and `chainId`
- `transactions_per_block` - Transactions per block, tagged with `status`, `block_number`, and `chainId`
- `rpc_latency` - Response time of RPC endpoints in ms, tagged with `endpoint` and `chainId`
- `rpc_status` - Status of RPC endpoints (1=up, 0=down), tagged with `endpoint` and `chainId`
- `websocket_status` - Status of WebSocket endpoints (1=up, 0=down), tagged with `endpoint` and `chainId`
- `explorer_status` - Status of explorer endpoints (1=up, 0=down), tagged with `endpoint` and `chainId`
- `faucet_status` - Status of faucet endpoints (1=up, 0=down), tagged with `endpoint` and `chainId`
- `block_time` - Time between blocks in seconds, tagged with `chainId`
- `transaction_monitor` - Transaction test results, tagged with `type`, `chainId`, and `rpc`
- `transaction_monitor_confirmation_time` - Transaction confirmation time in ms, tagged with `type`, `chainId`, and `rpc`
- `wallet_balance` - Test wallet balances, tagged with `chainId`, with a field for sufficient balance
- `validator_summary` - Summary metrics for validators, tagged with `chainId`
- `validator_nodes` - Count of masternodes, standbynodes, and penalty nodes
- `consensus_missed_rounds` - Tracks missed mining rounds with detailed information
- `consensus_timeout_periods` - Records timeout periods between blocks with duration and miners skipped
- `consensus_miner_performance` - Complete mining performance data by validator

## Transaction Monitoring

The system includes comprehensive transaction monitoring capabilities:

### Features

- **Automated Testing**: Regularly runs test transactions on all active RPC endpoints
- **Test Types**: Includes both normal value transfers and smart contract deployments
- **Multi-Chain Support**: Tests both Mainnet (chainId 50) and Testnet (chainId 51)
- **Wallet Management**: Continuously monitors test wallet balances
- **Performance Metrics**: Tracks transaction confirmation times and success rates
- **Failure Rate Monitoring**: Tracks transaction failure rates across RPC endpoints and generates alerts when more than 50% of endpoints fail
- **Detailed Failure Reporting**: Provides specific lists of failing RPC endpoints in alerts for quick troubleshooting
- **Per-Network Tracking**: Monitors transaction types separately for each network with individual failure rate calculations
- **Multi-Endpoint Validation**: Tests transaction functionality across all available RPC endpoints on each network

### Failure Rate Detection

The transaction monitor includes advanced failure rate detection:

- **50% Threshold Alerting**: Automatically generates error alerts when 50% or more RPC endpoints fail transaction tests
- **Transaction Type Separation**: Monitors normal transactions and contract deployments separately
- **Network-Specific Tracking**: Maintains separate failure rates for Mainnet (chainId 50) and Testnet (chainId 51)
- **Detailed Endpoint Information**: Alert messages include complete lists of failing RPC endpoints for rapid issue resolution
- **Real-Time Monitoring**: Failure rates are calculated in real-time during each 5-minute test cycle

### Requirements

To use transaction monitoring, you need:

1. **Test wallets** with private keys specified in the configuration
2. **Sufficient balance** in each test wallet (minimum 0.01 XDC)
3. **Receiver addresses** for test transactions

Test transactions are executed every 5 minutes by default, with metrics being recorded in InfluxDB and visualized in Grafana.

## Alert System and Reporting

The application features a comprehensive alert and reporting system for monitoring blockchain health.

### Alert Features

- **Multi-level Severity**: Alerts are categorized as `error`, `warning`, or `info`
- **Network-specific Alerting**: Alerts can be associated with specific chains (Mainnet or Testnet)
- **Component Attribution**: Alerts include the source component that triggered them
- **Multi-channel Delivery**: Supports sending alerts to Telegram, webhooks, and the dashboard
- **Intelligent Throttling**: Prevents alert floods by limiting frequency of similar alerts
- **Smart Alert Classification**: Automatically determines network association through chainId and content pattern matching

### Telegram Integration

- **Topic-based Routing**:
  - Alerts for Mainnet (chainId=50) route to a dedicated Mainnet topic
  - Alerts for Testnet (chainId=51) route to a dedicated Testnet topic
  - General alerts go to the main conversation thread
- **Formatted Messages**: Clear, well-formatted messages with emoji indicators and detailed information
- **HTML Formatting**: Uses HTML formatting with monospace tables and Unicode box-drawing characters for bordered tables

### Weekly Reports

The system automatically generates weekly alert reports that provide insights into system health:

- **Comprehensive Statistics**:
  - Total alert counts by severity (error/warning/info)
  - Breakdown by network (Mainnet/Testnet/Other)
  - Component-specific analytics
  - Most frequent alert types
- **Manual Report Generation**:

  - Generate reports for custom date ranges
  - Get formatted messages for communication channels
  - Trigger immediate report delivery to configured channels

- **Report Archiving**:
  - System maintains the last 4 weeks of reports
  - Data is stored in both memory and InfluxDB for reliability

### Alert Classification System

The system uses a robust approach to classify alerts by network:

1. **Primary Classification**: Uses the chainId field when available (chainId=50 for Mainnet, chainId=51 for Testnet)

2. **Pattern-Based Classification**: For legacy alerts or those without chainId, analyzes alert title and message content for patterns:

   - Mainnet indicators: "mainnet", "chain 50", "chainId 50"
   - Testnet indicators: "testnet", "chain 51", "chainId 51"

3. **Fallback Category**: Alerts that can't be classified as either Mainnet or Testnet are categorized as "Other"

This approach ensures accurate network classification for all alerts, regardless of how they were created.

### Report Formatting

Weekly reports are displayed using a modular, optimized structure:

- **Network-Specific Sections**: Dedicated sections for Mainnet, Testnet, and Other alerts
- **Severity Tables**: Clear breakdown of errors, warnings, and info alerts per network
- **Component Tables**: Details of affected components with alert counts by severity
- **Bordered Tables**: All tables use Unicode box-drawing characters for clear visual structure
- **Most Frequent Alerts**: Summary of the most common alert types across all networks

### Alert Types

The system monitors for various alert conditions:

1. **Block Time Alerts**: Warnings when block time exceeds thresholds
2. **Transaction Error Alerts**: Notifications of high transaction error rates
3. **RPC Response Time Alerts**: Alerts for slow or non-responsive RPC endpoints
4. **High Transaction Volume Alerts**: Notifications of unusual transaction activity
5. **Consensus Alerts**: Notifications about consensus issues like missed rounds and validator penalties

### Testing Alert System

You can test the alert system using the testing endpoints:

- Manually trigger individual alerts with `/api/testing/trigger-manual-alert`
- Test all alert types at once with `/api/testing/trigger-all-alerts`
- Test specific alert categories with `/api/testing/trigger-alert/{type}`
- Test network-specific routing with `/api/testing/test-telegram-topics`
- Generate and view weekly reports with `/api/testing/generate-weekly-report`
- Get formatted report messages with `/api/testing/weekly-report-message`
- Send weekly reports to all channels with `/api/testing/send-weekly-report`

## InfluxDB and Grafana Integration

The project uses InfluxDB for storing metrics and Grafana for visualization. The integration is configured automatically when you start the Docker containers.

### Managing Grafana Configurations

This project uses a special approach to manage Grafana configurations:

1. The actual Grafana data is stored in `grafana_data/` (ignored by Git)
2. Version-controlled configurations are stored in `grafana_config/`
3. Two helper commands synchronize between these directories:

```bash
# Export your current Grafana configurations to the version-controlled directory
./run.sh grafana-export

# Import the version-controlled configurations to your local Grafana
./run.sh grafana-import
```

## Security Practices

### Sensitive Information

This project uses several pieces of sensitive information that should **never** be committed to Git repositories:

1. **Telegram Bot Token**: Used for alerting notifications
2. **Telegram Chat ID**: Identifies where alerts are sent
3. **API Keys and Tokens**: Any other authentication tokens
4. **Database Credentials**: If using external databases
5. **Private Keys**: Never commit wallet private keys to the repository

### Safe Practices

#### Environment Variables

- Always use `.env` files for sensitive information
- Never commit the actual `.env` file to Git
- Provide an `.env.example` file with dummy values as a template

#### Configuration Files

- For configs that might contain sensitive data (like alerting configs), use template files
- Name template files with `.example` suffix (e.g., `alertmanager.example.yaml`)
- Ensure your `.gitignore` excludes real config files but includes examples

### Setup for New Developers

1. Clone the repository
2. Copy example files:
   ```bash
   cp .env.example .env
   cp grafana_data/provisioning/alerting/alertmanager.example.yaml grafana_data/provisioning/alerting/alertmanager.yaml
   cp grafana_data/provisioning/alerting/rules.example.yaml grafana_data/provisioning/alerting/rules.yaml
   ```
3. Fill in your actual credentials in the `.env` file
4. Do NOT commit your changes to the configuration files

### Credential Rotation

Regularly rotate credentials, especially if:

- Someone leaves the development team
- You suspect a credential has been compromised
- It has been a long time since the last rotation

## Required GitHub Secrets for CI/CD

To use the CI/CD workflows, you need to set up these secrets in your GitHub repository:

### For Staging Deployment

- `STAGING_SSH_KEY`: Private SSH key for connecting to staging server
- `STAGING_HOST`: Hostname or IP address of staging server
- `STAGING_USER`: Username for SSH connection to staging server
- `STAGING_DEPLOY_PATH`: (Optional) Path where the application should be deployed
- `STAGING_INFLUXDB_TOKEN`: InfluxDB authentication token
- `STAGING_INFLUXDB_ORG`: InfluxDB organization name
- `STAGING_INFLUXDB_BUCKET`: InfluxDB bucket name
- `STAGING_INFLUXDB_ADMIN_USER`: InfluxDB admin username
- `STAGING_INFLUXDB_ADMIN_PASSWORD`: InfluxDB admin password
- `STAGING_TELEGRAM_BOT_TOKEN`: Telegram bot token for notifications
- `STAGING_TELEGRAM_CHAT_ID`: Telegram chat ID for notifications
- `STAGING_GRAFANA_ADMIN_USER`: Grafana admin username
- `STAGING_GRAFANA_ADMIN_PASSWORD`: Grafana admin password

## Code Organization

The project follows a clean, modular architecture:

```
src/
├── common/                  # Shared code across the entire application
│   ├── constants/           # Configuration constants and defaults
│   │   ├── config.ts        # Core configuration constants
│   │   ├── endpoints.ts     # Network endpoints definitions
│   │   └── monitoring.ts    # Monitoring thresholds and settings
│   └── utils/               # Utility classes and helper functions
├── types/                   # TypeScript type definitions
│   ├── blockchain/          # Blockchain data structures
│   ├── monitoring/          # Monitoring configuration interfaces
│   └── rpc/                 # RPC endpoints and configuration
├── config/                  # Configuration module and service
│   ├── config.module.ts     # Configuration module definition
│   └── config.service.ts    # Service for accessing configuration
├── blockchain/              # Blockchain interaction services
├── logging/                 # Comprehensive logging system
│   ├── logger.service.ts    # Winston-based logging service with daily organization
│   ├── logger.module.ts     # NestJS module configuration for logging
│   ├── index.ts            # Exports for easier importing
│   └── README.md           # Comprehensive logging documentation
├── monitoring/              # Core monitoring services
│   ├── alerts.service.ts    # Alert configuration and delivery
│   ├── blocks.monitor.ts    # Block monitoring implementation
│   ├── rpc.monitor.ts       # RPC endpoint monitoring
│   ├── transaction.monitor.ts # Transaction monitoring implementation
│   ├── consensus/           # Consensus monitoring services
│   │   ├── consensus.monitor.ts # Main consensus orchestration service
│   │   ├── miner/           # Masternode mining monitoring
│   │   ├── epoch/           # Epoch and penalty tracking
│   │   └── reward/          # Reward distribution monitoring
│   ├── monitoring.controller.ts # API endpoints for monitoring data
│   ├── notification.controller.ts # Notification endpoints
│   └── testing.controller.ts # Testing endpoints
└── metrics/                 # Metrics collection and reporting
```

### Key Configuration Components

1. **Environment Variables**: Defined in `.env` file with examples in `.env.example`

2. **Config Constants**: Centralized in `src/common/constants/config.ts`

   - `ENV_VARS`: Mapping of all environment variable names
   - `FEATURE_FLAGS`: Feature toggles for different parts of the system
   - `DEFAULTS`: Default values when environment variables are missing
   - `ALERTS`: Alert thresholds and configuration

3. **Configuration Service**: Implemented in `src/config/config.service.ts`

   - Loads configuration from environment variables
   - Provides typed access with validation
   - Handles defaults and fallbacks

4. **Interfaces**: Structured type definitions
   - `MonitoringConfig`: Configuration for all monitoring components
   - `AlertNotificationConfig`: Configuration for notification channels
   - `InfluxDbConfig`: Configuration for InfluxDB metrics storage

### Key Utility Classes

The application includes several powerful utilities:

1. **EnhancedQueue**: For reliable processing of blocks and transactions

   - Priorities for critical tasks
   - Automatic retry of failed operations
   - Concurrency control and timeout handling

2. **TimeWindowData**: Efficient time-series data management

   - Automatic cleanup of outdated points
   - Statistical functions (min, max, average)
   - Memory-efficient storage

3. **AlertManager**: Centralized alert management

   - Multiple delivery channels (Telegram, webhook, dashboard)
   - Alert throttling to prevent notification storms
   - Severity-based prioritization
   - Network classification for targeted routing

4. **CustomLoggerService**: Enterprise-grade logging service

   - Winston-based logging with multiple transports
   - Daily log organization for easy investigation
   - Specialized logging methods for different components
   - Automatic exception handling and structured metadata
   - Performance monitoring and metrics logging

5. **Modular Helpers**: Optimized code structure with reusable components

   - Smart network detection for Mainnet/Testnet classification
   - Standardized table formatting for consistent display
   - Component aggregation for detailed reporting
   - Runtime optimization through code reuse

6. **ConsensusMonitor**: Orchestration for consensus monitoring
   - Coordinated initialization of component monitors
   - Centralized validator data management
   - Complete round-trip monitoring for consensus violations
   - Sliding window approach for memory-efficient state tracking

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## License

This project is licensed under the MIT License - see the LICENSE file for details.
