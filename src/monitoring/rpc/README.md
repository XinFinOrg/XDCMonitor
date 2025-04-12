# RPC Monitor

## Purpose and Responsibilities

The RPC Monitor service monitors the health and performance of XDC RPC endpoints, WebSocket connections, and related services. It implements sophisticated testing strategies including port monitoring, latency tracking, and adaptive check frequencies based on endpoint health.

## Core Workflows

1. **RPC Endpoint Monitoring**: Tests HTTP/HTTPS JSON-RPC endpoints through direct RPC calls (`eth_chainId`) and validates responses
2. **WebSocket Monitoring**: Establishes and verifies WebSocket connections with subscription tests
3. **Port Monitoring**: Verifies endpoint port availability through TCP connection tests
4. **Explorer & Faucet Monitoring**: Checks related infrastructure services through HTTP requests
5. **Adaptive Monitoring**: Dynamically adjusts check frequency based on endpoint health status (increases frequency for problematic endpoints)
6. **Batch Processing**: Processes endpoint checks in configurable batches with delays to prevent resource spikes
7. **Priority-Based Checking**: Prioritizes checking of down endpoints to detect recovery faster

## Configuration Options

- `enableRpcMonitoring`: Toggle monitoring on/off via ConfigService
- Interval settings (configurable via environment variables):
  - `RPC_CHECK_INTERVAL_MS`: RPC endpoint check interval (default: 30000ms)
  - `WS_CHECK_INTERVAL_MS`: WebSocket check interval (default: 30000ms)
  - `PORT_CHECK_INTERVAL_MS`: Port check interval (default: 30000ms)
  - `SERVICE_CHECK_INTERVAL_MS`: Service check interval (default: 60000ms)
  - `SYNC_INTERVAL_MS`: Blockchain service sync interval (default: 60000ms)
- Batch configuration:
  - `RPC_CHECK_BATCH_SIZE`: Number of RPC endpoints to check in parallel (default: 3)
  - `WS_CHECK_BATCH_SIZE`: Number of WebSocket endpoints to check in parallel (default: 2)
  - `BATCH_DELAY_MS`: Delay between batches to prevent resource spikes (default: 500ms)
- Adaptive monitoring settings:
  - `ENABLE_ADAPTIVE_MONITORING`: Toggle adaptive monitoring (default: false)
  - `MAX_CHECK_INTERVAL_MS`: Maximum interval for healthy endpoints (default: 120000ms)
  - `MIN_CHECK_INTERVAL_MS`: Minimum interval for problematic endpoints (default: 15000ms)

## Integration Points

- **BlockchainService**: Access to blockchain providers and client management
- **ConfigService**: Retrieves endpoint configurations and environment variables
- **MetricsService**: Reports detailed endpoint metrics including latency and availability
- **AlertService**: Sends alerts when endpoints experience extended downtime (configurable threshold)

## API Endpoints

- `/monitoring/websocket-status`: Returns WebSocket connection status for all monitored endpoints
- Exposes methods for other components to query endpoint status:
  - `getAllRpcStatuses()`: Returns status of all RPC endpoints
  - `getAllWsStatuses()`: Returns status of all WebSocket endpoints
  - `getAllExplorerStatuses()`: Returns status of all explorer services
  - `getAllFaucetStatuses()`: Returns status of all faucet services

## Status Tracking

- Sophisticated status maps tracking uptime/downtime with timestamps
- Latency tracking for performance analysis
- Health factor calculations based on endpoint availability percentages
- Downtime notification management with configurable thresholds (default: 1 hour)

## Key Features

- **Multi-Method Verification**: Uses both direct RPC calls and blockchain service providers
- **Staggered Initialization**: Prevents resource spikes by spacing out initial endpoint checks
- **Parallel Batch Processing**: Processes endpoints in configurable parallel batches
- **WebSocket Subscription Testing**: Verifies WebSocket functionality with real subscriptions
- **Port Availability Checks**: Validates network connectivity independent of service availability
- **Service Health Metrics**: Tracks explorer and faucet service availability
- **Adaptive Check Frequencies**: Increases check frequency for problematic endpoints
- **Automatic Client Management**: Creates and manages RPC clients with retry capabilities
- **Health Factor Calculation**: Provides overall health percentage for monitoring dashboards
- **Priority-Based Recovery Detection**: Checks down endpoints more frequently to detect recovery
