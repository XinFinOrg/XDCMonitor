# RPC Monitor

## Purpose and Responsibilities

The RPC Monitor service monitors the health and performance of XDC RPC endpoints, WebSocket connections, and related services. It implements sophisticated testing strategies including port monitoring, latency tracking, and adaptive check frequencies based on endpoint health. The system now includes intelligent dynamic RPC endpoint selection for optimal blockchain service reliability.

### RPC Selector Service

The `RpcSelectorService` is the core intelligence of the dynamic RPC selection system, providing:

- **Dynamic Endpoint Selection**: Automatically chooses the best available RPC endpoint for each blockchain network based on real-time health metrics
- **Quality Tier Management**: Classifies endpoints into quality tiers (HIGH, MEDIUM, LOW, UNKNOWN) based on historical performance and reliability
- **Multi-Factor Health Assessment**: Evaluates endpoints using multiple criteria including latency, success rates, block height sync status, and quality tier
- **Intelligent Failover**: Seamlessly switches primary endpoints when issues are detected while preventing rapid toggling with configurable minimum switch intervals
- **Exponential Decay Scoring**: Weights recent performance more heavily than historical data for responsive health assessment
- **Block Height Sync Monitoring**: Continuously monitors if endpoints are keeping up with the network by comparing block heights
- **Performance History Tracking**: Maintains detailed performance statistics with automatic promotion/demotion of quality tiers

### RPC Monitor Service

The `RpcMonitorService` handles both HTTP/HTTPS RPC endpoints and WebSocket endpoints through a centralized, optimized monitoring architecture:

- Uses a generic `monitorEndpoints` function to handle both types of endpoints with the same core logic
- Employs utility functions like `isWebSocketEndpoint` and `parseEndpointUrl` to reduce code duplication
- Features improved WebSocket testing with comprehensive error handling and cleanup
- Implements a unified peer count monitoring system through the `monitorPeerCount` utility
- **Integrates with RpcSelectorService** to provide real-time health data for dynamic endpoint selection
- **Enhanced sync monitoring** with block height comparison and lag detection across all endpoints

## Core Workflows

1. **Dynamic RPC Selection**: The primary workflow for selecting optimal endpoints:

   - **Health Data Collection**: RpcMonitorService continuously feeds health metrics to RpcSelectorService
   - **Quality Assessment**: Endpoints are automatically classified and scored based on performance
   - **Selection Algorithm**: Multi-factor scoring considers latency (40%), success rate (30%), sync status (20%), and quality tier (10%)
   - **Intelligent Switching**: Automatic failover when current primary has issues or better alternatives are available
   - **Switch Protection**: Minimum 5-minute intervals between switches to prevent rapid toggling

2. **RPC Endpoint Monitoring**: Tests HTTP/HTTPS JSON-RPC endpoints through direct RPC calls (`eth_chainId`) and validates responses through multiple methods:

   - Primary: Using BlockchainService's providers for efficient validation
   - Fallback: Direct RPC calls through RpcRetryClient with configurable retry mechanisms
   - Latency measurement and threshold alerting
   - **Health data feeding**: Results are automatically fed to RpcSelectorService for endpoint selection

3. **WebSocket Monitoring**: Establishes and verifies WebSocket connections using an optimized connection handling system:

   - Efficient WebSocket validation with proper resource cleanup
   - Timeout handling to prevent hanging connections
   - Multiple verification strategies (active connection and BlockchainService integration)
   - SafeResolve pattern to prevent memory leaks and duplicate state transitions

4. **Port Monitoring**: Verifies endpoint port availability through TCP connection tests with unified URL parsing logic

5. **Explorer & Faucet Monitoring**: Checks related infrastructure services through HTTP requests

6. **Block Height Sync Monitoring**: Enhanced monitoring that checks if endpoints are keeping up with the network:

   - **Cross-Endpoint Comparison**: Compares block heights across all active endpoints to identify the network's current state
   - **Lag Detection**: Identifies endpoints that are falling behind in synchronization
   - **Sync Status Updates**: Feeds sync status information to RpcSelectorService for intelligent endpoint selection
   - **Threshold-Based Alerting**: Generates alerts when endpoints fall behind by configurable thresholds (default: 100+ blocks)

7. **Adaptive Monitoring**: Dynamically adjusts check frequency based on endpoint health status:

   - Health factor calculation based on endpoint availability
   - Frequency scaling from min/max interval bounds
   - More frequent checks for problematic endpoints

8. **Batch Processing**: Processes endpoint checks in configurable batches with delays to prevent resource spikes:

   - Parallelized batch processing with individual error handling
   - Prioritized endpoint ordering (down endpoints checked first)
   - Configurable batch sizes and delays

9. **Priority-Based Checking**: Prioritizes checking of down endpoints to detect recovery faster

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

### RPC Selector Configuration

The RpcSelectorService uses internal configuration constants but respects the following thresholds from the monitoring config:

- **Minimum Switch Interval**: 5 minutes (300,000ms) to prevent rapid endpoint toggling
- **Good Latency Threshold**: 1000ms for considering an endpoint performant
- **Maximum Blocks Behind**: 50 blocks for considering an endpoint in sync
- **Quality Tier Thresholds**:
  - HIGH: 95%+ success rate with good latency and sync status
  - MEDIUM: 85%+ success rate with acceptable performance
  - LOW: Assigned after 3+ consecutive failures

## Integration Points

- **BlockchainService**: Access to blockchain providers and client management; **now integrates with RpcSelectorService** for dynamic endpoint selection
- **ConfigService**: Retrieves endpoint configurations and environment variables
- **MetricsService**: Reports detailed endpoint metrics including latency and availability
- **AlertService**: Sends alerts when endpoints experience extended downtime (configurable threshold) or sync lag issues
- **RpcSelectorService Integration**:
  - **Health Data Flow**: RpcMonitorService feeds real-time health metrics to RpcSelectorService
  - **Sync Status Updates**: Block height sync information is continuously updated
  - **Bidirectional Communication**: RpcSelectorService influences which endpoints are prioritized for monitoring

## API Endpoints

### New RPC Selection Endpoints

- `/api/monitoring/rpc/health`: Returns comprehensive health metrics for all RPC endpoints across all networks
- `/api/monitoring/rpc/health/:chainId`: Returns health metrics for endpoints on a specific chain (50=Mainnet, 51=Testnet)
- `/api/monitoring/rpc/primary`: Returns currently selected primary RPC endpoints for all networks
- `/api/monitoring/rpc/primary/:chainId`: Returns the currently selected primary RPC endpoint for a specific chain
- `/api/monitoring/rpc/status`: Returns comprehensive status information for all monitored endpoints

### Existing Endpoints

- `/monitoring/websocket-status`: Returns WebSocket connection status for all monitored endpoints
- Exposes methods for other components to query endpoint status:
  - `getAllRpcStatuses()`: Returns status of all RPC endpoints
  - `getAllWsStatuses()`: Returns status of all WebSocket endpoints
  - `getAllExplorerStatuses()`: Returns status of all explorer services
  - `getAllFaucetStatuses()`: Returns status of all faucet services

## Status Tracking

### Enhanced Status Management

- **Multi-Dimensional Health Tracking**: Combines traditional up/down status with comprehensive health metrics
- **Quality Tier Evolution**: Automatic promotion/demotion based on consistent performance patterns
- **Exponential Decay Metrics**: Recent performance weighted more heavily than historical data
- **Sync Status Integration**: Block height synchronization status as a key health factor
- **Performance History**: Detailed tracking of success rates, latency trends, and reliability patterns

### Traditional Status Tracking

- Sophisticated status maps tracking uptime/downtime with timestamps
- Latency tracking for performance analysis
- Health factor calculations based on endpoint availability percentages
- Downtime notification management with configurable thresholds (default: 1 hour)

## Key Features

### New Dynamic Selection Features

- **Intelligent Endpoint Selection**: Multi-factor algorithm automatically chooses optimal endpoints
- **Quality Tier Classification**: Automatic categorization based on performance history
- **Self-Healing Infrastructure**: Automatic adaptation to network conditions and endpoint issues
- **Sync Status Monitoring**: Continuous monitoring of block height synchronization across endpoints
- **Performance-Based Switching**: Automatic failover based on comprehensive health assessment
- **Switch Interval Protection**: Prevents rapid endpoint switching with configurable minimum intervals
- **Real-Time Health Updates**: Continuous health metric updates for responsive endpoint selection

### Existing Features

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

## Module Architecture

### RpcSelectorModule

A dedicated module that provides the `RpcSelectorService`:

```typescript
@Module({
  imports: [ConfigModule],
  providers: [RpcSelectorService],
  exports: [RpcSelectorService],
})
export class RpcSelectorModule {}
```

### Integration Pattern

The RPC monitoring system follows a clean dependency injection pattern:

1. **RpcSelectorModule**: Provides the core selection intelligence
2. **RpcModule**: Combines monitoring services with selection capability
3. **MonitoringModule**: Integrates RPC monitoring with the broader monitoring system
4. **BlockchainModule**: Imports RpcSelectorModule for dynamic endpoint selection in blockchain operations

This architecture prevents circular dependencies while enabling seamless integration between monitoring and selection capabilities.
