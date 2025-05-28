# Blocks Monitor

## Purpose and Responsibilities

The Blocks Monitor service monitors blocks across XDC networks (Mainnet and Testnet). It tracks block heights, transaction counts, and block time intervals using resilient RPC clients with automatic failover capabilities. The service provides comprehensive block-level monitoring with intelligent endpoint selection, transaction analysis, and sync lag detection.

## Core Workflows

1. **Multi-Endpoint Block Height Monitoring**: Tracks block heights across all configured HTTP RPC endpoints and identifies discrepancies
2. **Intelligent Endpoint Selection**: Automatically selects the best available endpoint based on block height and health status
3. **Block Time Analysis**: Measures time between blocks within 24-hour sliding windows to detect network slowdowns
4. **Comprehensive Transaction Processing**: Analyzes transaction success/failure rates within blocks with adaptive batch processing
5. **Automatic Endpoint Failover**: Switches to healthy endpoints when primary endpoints fail with downtime tracking
6. **Advanced Sync Lag Detection**: Identifies and alerts when endpoints fall significantly behind in block height with intelligent aggregation
7. **Primary Endpoint Downtime Monitoring**: Tracks endpoint downtime and sends alerts after 1-hour threshold
8. **Block Height Variance Calculation**: Calculates variance between endpoints to detect synchronization issues

## Architecture and Implementation

### Service Structure

- **Injectable NestJS Service**: Implements `OnModuleInit` for proper lifecycle management
- **Modular Initialization**: Separate initialization phases for time windows, configuration, networks, and RPC clients
- **Resilient Startup**: Graceful initialization with configurable delays and error recovery
- **Clean Shutdown**: Proper cleanup of intervals and resources on module destruction

### Network Management

- **Dual Network Support**: Monitors both Mainnet (chainId: 50) and Testnet (chainId: 51)
- **Dynamic Endpoint Configuration**: Loads endpoints from ConfigService with runtime updates
- **Primary Endpoint Tracking**: Maintains primary endpoint status with downtime detection
- **Best Endpoint Selection**: Automatically selects endpoints with highest block height

### Data Structures and State Management

- **Time Window Data**: Efficient sliding window tracking for block times and transaction metrics
- **Endpoint Block Heights**: Real-time tracking of block heights per endpoint per network
- **Primary Endpoint Status**: Downtime tracking with alert state management
- **Network Configurations**: Centralized network configuration with RPC client management

## Configuration Options

### Core Configuration

- `enableBlockMonitoring`: Toggle feature on/off via ConfigService (default: true)
- `scanInterval`: Time between block checks (default: 15000ms)
- `BLOCKCHAIN.BLOCKS.DEFAULT_SCAN_INTERVAL_MS`: Default scan interval fallback
- `BLOCKCHAIN.BLOCKS.BLOCK_TIME_ERROR_THRESHOLD`: Block time threshold for alerts

### Timing Configuration

- `startupDelay`: Delay before starting monitoring (5000ms)
- `errorRecoveryDelay`: Delay before retrying after errors (10000ms)
- `initialScanDelay`: Delay for initial scan (3000ms)

### Alert Thresholds

- `ALERTS.THRESHOLDS.SYNC_LAG_ERROR_BLOCKS`: Warning threshold for block lag (100 blocks)
- `ALERTS.THRESHOLDS.SYNC_LAG_CRITICAL_BLOCKS`: Critical threshold for block lag (1000 blocks)
- `ALERTS.NOTIFICATIONS.THROTTLE_SECONDS.SYNC_BLOCKS_LAG`: Alert throttling period
- `DOWNTIME_NOTIFICATION_THRESHOLD_MS`: Primary endpoint downtime threshold (1 hour)

### Transaction Processing Configuration

- `DEFAULT_BATCH_SIZE`: Default transaction batch size (20)
- `RECENT_BLOCKS_SAMPLE_SIZE`: Sample size for block time analysis
- `TRANSACTION_HISTORY_WINDOW_MS`: Time window for transaction history tracking

## Integration Points

### Service Dependencies

- **BlockchainService**: Access to blockchain providers and RPC clients for block and transaction data
- **ConfigService**: Configuration values for monitoring behavior and endpoint management
- **RpcMonitorService**: Coordination with RPC endpoint health monitoring via `getAllRpcStatuses()`
- **MetricsService**: Reports block metrics to InfluxDB for dashboards and alerting
- **AlertService**: Sends alerts for sync lag, downtime, and other detected issues
- **SchedulerRegistry**: Manages monitoring intervals with proper cleanup

### External Integrations

- **InfluxDB Metrics**: Writes block height, transaction, and timing metrics
- **Grafana Dashboards**: Provides data for block monitoring visualizations
- **Telegram Alerts**: Sends critical alerts through AlertService integration

## API Endpoints

### Monitoring Endpoints

- `/monitoring/block-status`: Returns detailed block monitoring information including:
  - Monitoring enabled status
  - Primary endpoints for each network
  - Block time thresholds and scan intervals
  - Monitored endpoints and their status
  - Block height variance calculations
  - Block time statistics with min/max/average
- `/monitoring/block-comparison`: Shows block height differences between endpoints with calculated variances

### Response Data Structures

- **BlockMonitoringInfo**: Comprehensive monitoring status with network-specific data
- **Block Time Statistics**: Count, average, min, max, and latest block times
- **RPC Status Maps**: Boolean status mapping for each endpoint by network
- **Block Height Variance**: Calculated variance between highest and lowest endpoints

## Data Structures and Types

### Core Data Types

- **TimeWindowData**: Efficient sliding window tracking for block times and transaction data
- **NetworkConfig**: Network configuration including endpoints, clients, and chain IDs
- **BlockInfo**: Block data including height, timestamp, hash, and transaction information
- **BlockMonitoringInfo**: Comprehensive monitoring status for API responses
- **PrimaryEndpointStatus**: Downtime tracking with alert state for primary endpoints

### Utility Classes

- **RpcRetryClient**: Resilient RPC client with automatic failover and configurable retry mechanisms
- **EnhancedQueue**: Priority-based processing queue (referenced but not directly used)

## Key Features and Capabilities

### Multi-Endpoint Monitoring

- **Comprehensive Endpoint Tracking**: Monitors all configured HTTP RPC endpoints per network
- **Real-time Block Height Comparison**: Tracks block heights across endpoints to identify discrepancies
- **Best Endpoint Selection**: Automatically selects endpoint with highest block height for data processing
- **Endpoint Health Integration**: Coordinates with RpcMonitorService for comprehensive health assessment

### Intelligent Failover and Recovery

- **Automatic Primary Endpoint Switching**: Switches to healthy endpoints when primary endpoints fail
- **Downtime Tracking**: Tracks endpoint downtime with 1-hour alert threshold
- **Graceful Error Handling**: Continues monitoring with fallback endpoints during failures
- **Recovery Detection**: Automatically resets status when endpoints come back online

### Advanced Transaction Analysis

- **Adaptive Batch Processing**: Dynamically adjusts batch size based on transaction volume (20-50 transactions per batch)
- **Parallel Transaction Processing**: Processes transaction batches in parallel for efficiency
- **Transaction Status Verification**: Verifies individual transaction success/failure status
- **Comprehensive Transaction Metrics**: Tracks confirmed, failed, and total transaction counts per block

### Sliding Window Analysis

- **24-Hour Block Time Windows**: Maintains rolling windows of block times for trend analysis
- **Transaction History Tracking**: Tracks transaction counts and failure rates over time
- **Statistical Analysis**: Provides min, max, average, and latest values for block times
- **Memory-Efficient Storage**: Automatically cleans up old data points to prevent memory leaks

### Resilient Initialization and Configuration

- **Staggered Startup**: Prevents resource spikes with configurable initialization delays
- **Dynamic Configuration Updates**: Runtime configuration updates without service restart
- **Endpoint Discovery**: Automatically discovers and configures endpoints from ConfigService
- **Fallback Mechanisms**: Provides fallback data when primary systems are unavailable

### Advanced Sync Lag Detection

- **Dual-Threshold System**: Warning alerts for 100-999 blocks behind, critical alerts for 1000+ blocks behind
- **Intelligent Alert Aggregation**: Groups multiple lagging endpoints into single alerts to reduce noise
- **Detailed Endpoint Information**: Provides specific block heights and lag amounts for each affected endpoint
- **Smart Alert Limiting**: Shows top 5 affected endpoints with summary for additional endpoints
- **Adaptive Throttling**: Uses configurable throttling periods to prevent alert fatigue during prolonged issues
- **Severity-Based Alerting**: Sends warning and error alerts through AlertService with appropriate severity levels

### Comprehensive Metrics and Monitoring

- **Block Height Metrics**: Records block heights with endpoint and chain ID tags
- **Block Time Tracking**: Measures and records time between consecutive blocks
- **Transaction Metrics**: Detailed transaction counts by status (total, confirmed, failed)
- **Transactions Per Minute**: Calculates and tracks transaction throughput rates
- **Block Height Variance**: Calculates variance between endpoints for sync monitoring
- **Endpoint Status Tracking**: Maintains real-time status of all monitored endpoints

### Error Handling and Resilience

- **Graceful Degradation**: Continues operation even when some endpoints fail
- **Comprehensive Error Logging**: Detailed logging for debugging and troubleshooting
- **Fallback Data Provision**: Provides fallback monitoring info when primary data is unavailable
- **Exception Safety**: Proper exception handling prevents service crashes
- **Resource Cleanup**: Proper cleanup of intervals and resources on shutdown

## Monitoring Workflow

### Initialization Phase

1. **Service Initialization**: Initialize time windows, load configuration, and set up networks
2. **RPC Client Setup**: Create resilient RPC clients with retry mechanisms for each network
3. **Endpoint Discovery**: Discover and configure all available RPC endpoints
4. **Initial Block Height Scan**: Scan all endpoints to establish baseline block heights
5. **Best Endpoint Selection**: Select optimal endpoints based on initial scan results

### Runtime Monitoring Cycle

1. **Multi-Endpoint Scanning**: Check block heights across all configured endpoints
2. **Best Endpoint Identification**: Identify endpoint with highest block height per network
3. **Block Data Processing**: Fetch and process latest block data from best endpoints
4. **Transaction Analysis**: Analyze transactions within blocks with batch processing
5. **Metrics Recording**: Record all metrics to InfluxDB for dashboard visualization
6. **Sync Lag Detection**: Check for endpoints significantly behind and trigger alerts
7. **Status Updates**: Update endpoint status and prepare for next monitoring cycle

### Alert and Recovery Workflow

1. **Sync Lag Detection**: Identify endpoints behind by 100+ or 1000+ blocks
2. **Alert Aggregation**: Group multiple lagging endpoints into comprehensive alerts
3. **Throttling Management**: Apply intelligent throttling to prevent alert fatigue
4. **Downtime Tracking**: Track primary endpoint downtime and alert after 1-hour threshold
5. **Recovery Detection**: Automatically reset alert states when endpoints recover

## Performance Optimizations

### Efficient Processing

- **Parallel Endpoint Checking**: Check multiple endpoints simultaneously for faster scanning
- **Adaptive Batch Sizing**: Dynamically adjust transaction batch sizes based on volume
- **Memory-Efficient Windows**: Use sliding windows with automatic cleanup for time-series data
- **Optimized Metrics Writing**: Batch metrics writes to reduce InfluxDB load

### Resource Management

- **Configurable Timeouts**: Short timeouts (3 seconds) for endpoint health checks
- **Connection Pooling**: Reuse RPC clients across monitoring cycles
- **Graceful Shutdown**: Proper cleanup of resources and intervals
- **Error Recovery**: Automatic recovery from transient failures without service restart

## Testing and Debugging

### Logging and Observability

- **Comprehensive Debug Logging**: Detailed logging for all monitoring activities
- **Performance Metrics**: Built-in latency and performance tracking
- **Error Context**: Rich error context for troubleshooting issues
- **Status Reporting**: Real-time status reporting through API endpoints

### Monitoring Health

- **Service Status API**: Check if block monitoring is enabled and functioning
- **Endpoint Status Tracking**: Monitor health of all configured endpoints
- **Block Height Variance**: Track synchronization between endpoints
- **Alert History**: Track alert frequency and patterns for optimization
