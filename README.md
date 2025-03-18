# XDC Network Monitor

A comprehensive Node.js-based monitoring system for the XDC Network. This application provides real-time monitoring of blockchain infrastructure with a focus on RPC endpoint monitoring, port monitoring, block propagation, alerting, and visualization.

## Features

- **RPC URL Monitoring**: Mainnet and Testnet endpoint monitoring, downtime detection, latency measurement
- **Multi-RPC Monitoring**: Monitor multiple endpoints simultaneously, compare response times
- **RPC Port Monitoring**: HTTP/HTTPS port checks, WebSocket port checks
- **Block Propagation Monitoring**: Block time tracking, slow block detection
- **Alert System**: Dashboard alerts, Telegram notifications, webhook notifications
- **Metrics Collection**: InfluxDB time-series database, Grafana dashboards

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
SCAN_INTERVAL=15

# Monitoring configuration
ENABLE_RPC_MONITORING=true
ENABLE_PORT_MONITORING=true
ENABLE_BLOCK_MONITORING=true
BLOCK_TIME_THRESHOLD=3.0

# Alert configuration
ENABLE_DASHBOARD_ALERTS=true
ENABLE_CHAT_NOTIFICATIONS=true
NOTIFICATION_WEBHOOK_URL=

# Telegram notification configuration
TELEGRAM_BOT_TOKEN="your-telegram-bot-token-here"
TELEGRAM_CHAT_ID="your-telegram-chat-id-here"

# Logging configuration
LOG_LEVEL=debug

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
```

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
- **Overall Status**: `/api/monitoring/status` - Combined status of all monitoring systems
- **Notifications Test**: `/api/notifications/test` - Test the notification system
- **Telegram Webhook**: `/api/notifications/telegram` - Endpoint for Grafana to send alerts

### Testing Endpoints

- **Trigger Manual Alert**: `/api/testing/trigger-manual-alert?type=error&title=Title&message=Message` - Directly trigger an alert
- **Simulate Slow Block Time**: `/api/testing/simulate-slow-blocktime?seconds=4` - Simulate a slow block time
- **Simulate RPC Down**: `/api/testing/simulate-rpc-down?endpoint=URL` - Simulate an RPC endpoint being down
- **Simulate RPC Latency**: `/api/testing/simulate-rpc-latency?endpoint=URL&latency=500` - Simulate high RPC latency

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
- `alert_count` - Count of alerts by type and component, tagged with `type`, `component`, and `chainId`

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

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## License

This project is licensed under the MIT License - see the LICENSE file for details.
