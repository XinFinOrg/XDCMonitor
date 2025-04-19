# RPC Monitor

## Purpose and Responsibilities

The RPC Monitor service monitors the health and performance of XDC RPC endpoints, WebSocket connections, and related services. It implements sophisticated testing strategies including port monitoring, latency tracking, and adaptive check frequencies based on endpoint health.

### RPC Monitor Service

The `RpcMonitorService` handles both HTTP/HTTPS RPC endpoints and WebSocket endpoints through a centralized, optimized monitoring architecture:

- Uses a generic `monitorEndpoints` function to handle both types of endpoints with the same core logic
- Employs utility functions like `isWebSocketEndpoint` and `parseEndpointUrl` to reduce code duplication
- Features improved WebSocket testing with comprehensive error handling and cleanup
- Implements a unified peer count monitoring system through the `monitorPeerCount` utility

## Core Workflows

1. **RPC Endpoint Monitoring**: Tests HTTP/HTTPS JSON-RPC endpoints through direct RPC calls (`eth_chainId`) and validates responses through multiple methods:
   - Primary: Using BlockchainService's providers for efficient validation
   - Fallback: Direct RPC calls through RpcRetryClient with configurable retry mechanisms
   - Latency measurement and threshold alerting

2. **WebSocket Monitoring**: Establishes and verifies WebSocket connections using an optimized connection handling system:
   - Efficient WebSocket validation with proper resource cleanup
   - Timeout handling to prevent hanging connections
   - Multiple verification strategies (active connection and BlockchainService integration)
   - SafeResolve pattern to prevent memory leaks and duplicate state transitions

3. **Port Monitoring**: Verifies endpoint port availability through TCP connection tests with unified URL parsing logic

4. **Explorer & Faucet Monitoring**: Checks related infrastructure services through HTTP requests

5. **Adaptive Monitoring**: Dynamically adjusts check frequency based on endpoint health status:
   - Health factor calculation based on endpoint availability
   - Frequency scaling from min/max interval bounds
   - More frequent checks for problematic endpoints

6. **Batch Processing**: Processes endpoint checks in configurable batches with delays to prevent resource spikes:
   - Parallelized batch processing with individual error handling
   - Prioritized endpoint ordering (down endpoints checked first)
   - Configurable batch sizes and delays

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
- **Optimized Code Structure**: Utilizes helper functions to reduce duplication and improve maintainability
- **Memory Leak Prevention**: Properly cleans up resources, particularly in WebSocket connections

## Peer Count Monitoring

The `PeerCountMonitor` is a specialized service that works alongside `RpcMonitorService` to track peer counts across the network and detect anomalies:

### Approach

- **Adaptive Baselines**: Calculates dynamic peer count baselines based on historical data
- **Multi-Factor Analysis**: Uses both relative and absolute threshold calculations
- **Consecutive Zero Detection**: Identifies and alerts on consecutive zero-peer readings
- **Exponential Backoff**: Implements alert backoff periods to prevent alert storms
- **Network Classification**: Differentiates between high-peer and low-peer endpoints

### Key Features

- **Dynamic Threshold Calculation**: Proportional thresholds that scale with network size
- **Statistical Anomaly Detection**: Identifies significant deviations from established baselines
- **Historical High Value Tracking**: Maintains record of highest observed peer counts
- **Critical Issue Detection**: Special handling for zero-peer situations or major drops
- **Relative & Absolute Measurement**: Considers both percentage-based and absolute number drops
- **Alert Frequency Control**: Exponential backoff mechanism for repeated alerts
- **Telegram Integration**: Dedicated notifications for critical peer count issues

### Configuration

- Multiple threshold factors for different severity levels (significant vs. critical drops)
- Configurable sampling requirements for baseline establishment
- Customizable alert backoff periods and reset conditions
- Network-specific threshold adjustment based on node importance

### Integration with RpcMonitorService

The RPC monitor triggers peer count checks when an endpoint is found to be active. The integration is handled through dedicated methods:
- `monitorRpcPeerCount`: For HTTP/HTTPS endpoints
- `monitorWsPeerCount`: For WebSocket endpoints

Both utilize a shared `monitorPeerCount` utility to ensure consistent handling.
