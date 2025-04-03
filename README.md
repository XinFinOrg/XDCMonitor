# XDC Network Monitor

A comprehensive Node.js-based monitoring system for the XDC Network. This application provides real-time monitoring of blockchain infrastructure with a focus on RPC endpoint monitoring, port monitoring, block propagation, alerting, and visualization.

## Features

- **RPC URL Monitoring**: Mainnet and Testnet endpoint monitoring, downtime detection, latency measurement
- **Multi-RPC Monitoring**: Monitor multiple endpoints simultaneously, compare response times
- **RPC Port Monitoring**: HTTP/HTTPS port checks, WebSocket port checks
- **Block Propagation Monitoring**: Block time tracking, slow block detection
- **Transaction Monitoring**: Automated transaction testing, smart contract deployment testing
- **Alert System**: Dashboard alerts, Telegram notifications, webhook notifications
- **Metrics Collection**: InfluxDB time-series database, Grafana dashboards

## Architecture

The XDC Monitor has been optimized with a modular, maintainable architecture:

### Core Components

- **Shared Constants**: Configuration values are centralized in the `common/constants` directory
- **Enhanced Queue System**: Resilient job processing with retry, timeout, and prioritization
- **Time-Series Data Management**: Efficient time window data structures for metrics
- **Modular Services**: Clean separation of concerns with specialized service modules

### Performance Optimizations

- **Batched Processing**: Transaction processing uses parallel batching for higher throughput
- **Priority-based Queue**: Critical operations (like mainnet block processing) get priority
- **Efficient Memory Usage**: Time-window data structures automatically clean up old data
- **Smart Error Handling**: Automatic retry with exponential backoff for transient failures

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

# Webhook configuration
NOTIFICATION_WEBHOOK_URL="https://hooks.slack.com/services/XXX/YYY/ZZZ"
```

The system uses these environment variables to control alert behavior:

- `ENABLE_DASHBOARD_ALERTS`: Controls Grafana dashboard alerts
- `ENABLE_CHAT_NOTIFICATIONS`: Controls external notifications (Telegram and webhook)
- `TELEGRAM_BOT_TOKEN` & `TELEGRAM_CHAT_ID`: Required for Telegram notifications
- `NOTIFICATION_WEBHOOK_URL`: URL to send webhook alerts (for Slack, Discord, etc.)

### Testing Alerts

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

2. **Security Scan**: Checks for vulnerabilities

   - Runs npm audit and Trivy vulnerability scanner
   - Focuses on high and critical vulnerabilities

3. **Publish**: Publishes Docker images
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
BLOCK_TIME_THRESHOLD=3.0

# Alert configuration
ENABLE_DASHBOARD_ALERTS=true
ENABLE_CHAT_NOTIFICATIONS=true
NOTIFICATION_WEBHOOK_URL=

# Telegram notification configuration
TELEGRAM_BOT_TOKEN="your-telegram-bot-token-here"
TELEGRAM_CHAT_ID="your-telegram-chat-id-here"

# Logging configuration
LOG_LEVEL=info

# InfluxDB Configuration
INFLUXDB_URL=http://localhost:8086
INFLUXDB_TOKEN=your-influxdb-token
INFLUXDB_ORG=xdc
INFLUXDB_BUCKET=xdc_metrics
INFLUXDB_ADMIN_USER=admin
INFLUXDB_ADMIN_PASSWORD=secure-password

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

### Testing Endpoints

- **Trigger Manual Alert**: `/api/testing/trigger-manual-alert?type=error&title=Title&message=Message` - Directly trigger an alert
- **Simulate Slow Block Time**: `/api/testing/simulate-slow-blocktime?seconds=4` - Simulate a slow block time
- **Simulate RPC Down**: `/api/testing/simulate-rpc-down?endpoint=URL` - Simulate an RPC endpoint being down
- **Simulate RPC Latency**: `/api/testing/simulate-rpc-latency?endpoint=URL&latency=500` - Simulate high RPC latency
- **Run Transaction Test**: `/api/testing/run-transaction-test?chainId=50&type=normal` - Manually trigger a transaction test

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

## Transaction Monitoring

The system includes comprehensive transaction monitoring capabilities:

### Features

- **Automated Testing**: Regularly runs test transactions on all active RPC endpoints
- **Test Types**: Includes both normal value transfers and smart contract deployments
- **Multi-Chain Support**: Tests both Mainnet (chainId 50) and Testnet (chainId 51)
- **Wallet Management**: Continuously monitors test wallet balances
- **Performance Metrics**: Tracks transaction confirmation times and success rates

### Requirements

To use transaction monitoring, you need:

1. **Test wallets** with private keys specified in the configuration
2. **Sufficient balance** in each test wallet (minimum 0.01 XDC)
3. **Receiver addresses** for test transactions

Test transactions are executed every 5 minutes by default, with metrics being recorded in InfluxDB and visualized in Grafana.

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
├── monitoring/              # Core monitoring services
│   ├── alerts.service.ts    # Alert configuration and delivery
│   ├── blocks.monitor.ts    # Block monitoring implementation
│   ├── rpc.monitor.ts       # RPC endpoint monitoring
│   ├── transaction.monitor.ts # Transaction monitoring implementation
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

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## License

This project is licensed under the MIT License - see the LICENSE file for details.
