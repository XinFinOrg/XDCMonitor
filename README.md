# XDC Network Monitor (Node.js)

A comprehensive Node.js-based monitoring system for the XDC Network. This application provides real-time monitoring of blockchain infrastructure with a focus on:

- RPC endpoint monitoring (availability and performance)
- Multi-RPC endpoint health checks
- Port monitoring
- Alert notifications
- Prometheus metrics collection and visualization

## Features

- **RPC URL Monitoring**

  - Mainnet and Testnet endpoint monitoring
  - Downtime detection
  - Latency measurement
  - Curl API for external testing

- **Multi-RPC Monitoring**

  - Monitor multiple RPC endpoints simultaneously
  - Compare response times and availability across nodes
  - Load balancing checks
  - Block height comparison between nodes

- **RPC Port Monitoring**

  - HTTP/HTTPS port checks
  - WebSocket port checks
  - Automated connectivity testing

- **Block Propagation Monitoring**

  - Block time tracking
  - Slow block detection (configurable threshold)
  - Cross-node block height discrepancy detection

- **Alert System**

  - Customizable dashboard alerts
  - Chat channel notifications (via webhooks)
  - Detailed error reporting

- **Metrics Collection**
  - Prometheus metrics endpoint
  - Real-time metrics for RPC performance
  - Block and transaction statistics
  - Ready for Grafana integration
  - Multi-RPC comparative metrics

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
# Primary RPC endpoint
RPC_URL=https://rpc.xinfin.network    # Mainnet
# RPC_URL=http://157.173.195.189:8555  # Testnet
CHAIN_ID=50
SCAN_INTERVAL=15

# WebSocket URL (if available)
WS_URL=wss://ws.xinfin.network

# Monitoring configuration
ENABLE_RPC_MONITORING=true
ENABLE_PORT_MONITORING=true
ENABLE_BLOCK_MONITORING=true
BLOCK_TIME_THRESHOLD=3.0

# Alert configuration
ENABLE_DASHBOARD_ALERTS=true
ENABLE_CHAT_NOTIFICATIONS=false
NOTIFICATION_WEBHOOK_URL=

# Metrics configuration
METRICS_PORT=9090
ENABLE_PROMETHEUS=true

# Logging configuration
LOG_LEVEL=debug

# Multi-RPC monitoring
ENABLE_MULTI_RPC=true
```

## Usage

### Running in Development Mode

```bash
npm run start:dev
```

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
- Prometheus (metrics storage)
- Grafana (visualization)

#### Running Monitoring Infrastructure Only

If you want to run your application in development mode while still using Prometheus and Grafana:

```bash
# Run only Prometheus and Grafana
docker-compose up -d prometheus grafana

# Then run your application locally
npm run start:dev
```

#### Running Individual Services

```bash
# Run only Prometheus
docker-compose up -d prometheus

# Run only Grafana
docker-compose up -d grafana
```

## API Endpoints

- **Block Status**: `/monitoring/block-status` - Current block monitoring information
- **Block Comparison**: `/monitoring/block-comparison` - Comparison of block heights across RPCs
- **RPC Status**: `/monitoring/rpc-status` - Status of all RPC endpoints
- **WebSocket Status**: `/monitoring/websocket-status` - Status of WebSocket connections
- **Overall Status**: `/monitoring/status` - Combined status of all monitoring systems
- **Metrics**: `/metrics` - Prometheus-compatible metrics endpoint

## Metrics Collected

The application exposes the following Prometheus metrics:

- `xdc_block_height{network="50"}` - Current block height
- `xdc_transaction_count{status="confirmed|pending|failed"}` - Transaction counts by status
- `xdc_rpc_latency{endpoint="url"}` - Response time of RPC endpoints in ms
- `xdc_rpc_status{endpoint="url"}` - Status of RPC endpoints (1=up, 0=down)
- `xdc_block_time` - Time between blocks in seconds

Additionally, default Node.js metrics are collected (memory usage, garbage collection, etc.)

## Project Structure

- `src/blockchain/` - Blockchain interaction layer
- `src/config/` - Configuration management
- `src/models/` - Data structures and interfaces
- `src/monitoring/` - Monitoring services
- `src/metrics/` - Prometheus metrics collection

## Grafana Integration

For Grafana integration, a data source should be configured pointing to the Prometheus server.

### Setting Up Grafana Dashboard

1. Login to Grafana at http://localhost:3001 (default login: admin/admin)
2. Go to Configuration > Data Sources > Add data source
3. Select Prometheus
4. Set URL to http://prometheus:9090 (in Docker) or http://localhost:9091 (local dev)
5. Click "Save & Test"
6. Import dashboards from the `grafana/` directory or create new ones

### Recommended Dashboard Panels

- **Block Height**: Graph of `xdc_block_height`
- **Block Time**: Graph of `xdc_block_time`
- **RPC Availability**: Gauge of `xdc_rpc_status` by endpoint
- **RPC Latency**: Graph of `xdc_rpc_latency` by endpoint
- **Transaction Volume**: Graph of rate(xdc_transaction_count[5m])

## Docker Deployment

### Using the Helper Script

For convenience, this project includes a helper script to manage various deployment scenarios:

```bash
# Make the script executable (first time only)
chmod +x run.sh

# Show available commands
./run.sh help

# Start the complete stack (app + Prometheus + Grafana)
./run.sh up

# Start only the monitoring infrastructure for local development
./run.sh dev-infra

# View logs
./run.sh logs

# Clear metrics data
./run.sh clear-metrics

# Rebuild containers (after code changes)
./run.sh rebuild

# Clean up all containers, volumes and networks (fixes Docker issues)
./run.sh clean
```

### Using Docker Compose Directly

You can also use Docker Compose commands directly:

1. Build and start all services:

   ```bash
   docker-compose up -d
   ```

2. Stop all services:

   ```bash
   docker-compose down
   ```

3. View logs:

   ```bash
   docker-compose logs -f
   ```

4. Rebuild containers (after code changes):
   ```bash
   docker-compose build
   docker-compose up -d
   ```

### Development Setup

For the best development experience, you can run the monitoring infrastructure in Docker while running the XDC Monitor locally:

1. Start Prometheus and Grafana:

   ```bash
   # Using the helper script
   ./run.sh dev-infra

   # Or using Docker Compose directly
   docker-compose -f docker-compose.dev.yml up -d
   ```

2. Run the XDC Monitor application locally:
   ```bash
   npm run start:dev
   ```

This configuration uses a special Prometheus setup that connects to your locally running application.

### Data Persistence

Prometheus and Grafana data are stored in local directories for persistence and easy access:

- **Production Environment**:

  - Prometheus Data: `./prometheus_data/`
  - Grafana Data: `./grafana_data/`

- **Development Environment**:
  - Prometheus Data: `./prometheus_dev_data/`
  - Grafana Data: `./grafana_dev_data/`

You can back up these directories, inspect the data, or clear them if needed:

```bash
# Using the helper script
./run.sh clear-metrics

# Or manually
rm -rf prometheus_data/*
mkdir -p prometheus_data
```

### Accessing Services

- **XDC Monitor API**: http://localhost:3000
- **Metrics Endpoint**: http://localhost:9090/metrics
- **Prometheus**: http://localhost:9091
- **Grafana**: http://localhost:3001 (default login: admin/admin)

## Development Workflow

### Local Development with Docker Monitoring

For the best development experience, you can:

1. Run Prometheus and Grafana in Docker:

   ```bash
   docker-compose up -d prometheus grafana
   ```

2. Run the XDC Monitor locally:

   ```bash
   npm run start:dev
   ```

3. Access your metrics in Prometheus:

   - Open http://localhost:9091
   - Query for metrics like `xdc_block_height` or `xdc_rpc_status`

4. Build dashboards in Grafana using these metrics:
   - Open http://localhost:3001
   - Create or import dashboards using Prometheus as data source

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## License

This project is licensed under the MIT License - see the LICENSE file for details.

## Secure Credential Management

This project follows secure practices for managing sensitive credentials:

### How Credentials Are Handled

1. **Environment Variables**: All sensitive credentials (like Telegram bot tokens) are stored in the `.env` file, which is excluded from Git.

2. **Runtime Generation**: Sensitive configuration files are generated at container startup from environment variables, so credentials never exist in the codebase.

3. **Volume Separation**:
   - Shareable configurations (dashboards, data sources) are in separate volume mounts
   - Sensitive configurations are generated at runtime and not persisted

### Sharing Dashboards Without Exposing Credentials

The project is set up so you can:

- Share your Grafana dashboards via Git
- Keep your sensitive credentials private

#### What's Safe to Commit:

- `grafana_data/provisioning/dashboards/*.yaml` - Dashboard configurations
- `grafana_data/provisioning/datasources/*.yaml` - Data source configurations
- `grafana_data/provisioning/plugins/*.yaml` - Plugin configurations

#### What's Excluded from Git:

- `.env` file with sensitive credentials
- `grafana_data/provisioning/alerting/*.yaml` - Contains alert channel configs with credentials
- `grafana_data/provisioning/notifiers/*.yaml` - Contains notification configs with credentials

## Setup Instructions

1. Copy `.env.example` to `.env` and fill in your credentials:

   ```
   cp .env.example .env
   ```

2. Start the monitoring stack:

   ```
   docker-compose up -d
   ```

3. Access Grafana at http://localhost:3001 (default credentials: admin/admin)

## Updating Telegram Credentials

If you need to update your Telegram bot token or chat ID:

1. Update the values in your `.env` file
2. Restart the Grafana container:
   ```
   docker-compose restart grafana
   ```

The entrypoint script will automatically regenerate the configuration files with your new credentials.

## Getting Started

### Prerequisites

- Docker and Docker Compose
- Git

### Installation

1. Clone the repository:

```bash
git clone https://github.com/yourusername/XDCMonitor.git
cd XDCMonitor
```

2. Start the services:

```bash
docker-compose up -d
```

3. Access the Grafana dashboard at http://localhost:3001 (default credentials: admin/admin)

## Configuration

### Grafana

Grafana is configured to store dashboards and data sources in the `grafana_data` directory. When you make changes in the UI, they will be saved to this directory.

#### Setting up Telegram Notifications in Grafana UI

To configure Telegram notifications (instead of using environment variables):

1. Create a Telegram bot using [@BotFather](https://t.me/botfather) and get your bot token
2. Create a Telegram group or channel and get the chat ID
3. In Grafana, go to **Alerting** → **Contact points** → **New contact point**
4. Select "Telegram" as the integration
5. Enter your bot token and chat ID
6. Save the contact point

![Telegram Configuration](docs/images/telegram-config.png)

#### Creating and Saving Dashboards

When you create dashboards in the Grafana UI, they will be saved to the `grafana_data/data/dashboards` directory. These can be shared and versioned in your Git repository.

To export a dashboard for sharing:

1. Open the dashboard in Grafana
2. Click the gear icon (⚙️) to open dashboard settings
3. Click "JSON Model"
4. Copy the JSON and save it to a file in your project (e.g., `dashboards/my-dashboard.json`)

### Environment Variables

The project uses two environment files:

- `.env` - Contains application-specific configuration
- `.env.grafana` - Contains Grafana configuration (non-sensitive)

For sensitive information:

1. Duplicate the example environment files:
   ```
   cp .env.example .env
   cp .env.grafana.example .env.grafana
   ```
2. Edit the files and configure your settings
3. For sensitive information like API keys and tokens, configure them via the Grafana UI

## Sharing and Security

- The repository is designed so you can safely share your configuration without revealing sensitive information
- Sensitive data is stored in the Grafana database and not committed to Git
- When cloning to a new machine, you'll need to reconfigure sensitive values through the Grafana UI

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.
