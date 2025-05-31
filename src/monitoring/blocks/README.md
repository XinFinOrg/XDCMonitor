# Blocks Monitor

## Purpose and Responsibilities

The Blocks Monitor service monitors blocks across XDC networks (Mainnet and Testnet). It tracks block heights, transaction counts, and block time intervals using resilient RPC clients with automatic failover capabilities. The service provides comprehensive block-level monitoring with intelligent endpoint selection, adaptive transaction analysis, and sophisticated sync lag detection with dual-threshold alerting.

## Core Workflows

1. **Multi-Endpoint Block Height Monitoring**: Tracks block heights across all configured HTTP RPC endpoints and identifies discrepancies with real-time variance calculation
2. **Intelligent Endpoint Selection**: Automatically selects the best available endpoint based on block height synchronization for optimal data processing
3. **Block Time Analysis**: Measures time between blocks within 24-hour sliding windows to detect network slowdowns with comprehensive statistical tracking
4. **Adaptive Transaction Processing**: Analyzes transaction success/failure rates within blocks with dynamic batch processing (20-50 transactions per batch)
5. **Automatic Endpoint Failover**: Switches to healthy endpoints when primary endpoints fail with comprehensive downtime tracking and 1-hour alert threshold
6. **Sophisticated Sync Lag Detection**: Identifies and alerts when endpoints fall significantly behind with dual-threshold system (100 blocks warning, 1000 blocks critical) and intelligent alert aggregation
7. **Primary Endpoint Downtime Monitoring**: Tracks endpoint downtime with detailed status management and automatic recovery detection
8. **Block Height Variance Calculation**: Real-time calculation of synchronization differences between endpoints for network health assessment

## Architecture and Implementation

### Service Structure

- **Injectable NestJS Service**: Implements `OnModuleInit` for proper lifecycle management with staggered initialization
- **Modular Initialization**: Separate initialization phases for time windows, configuration, networks, and RPC clients with error recovery
- **Resilient Startup**: Graceful initialization with configurable delays (5s startup, 10s error recovery, 3s initial scan)
- **Clean Shutdown**: Proper cleanup of intervals and resources on module destruction through SchedulerRegistry

### Network Management

- **Dual Network Support**: Monitors both Mainnet (chainId: 50) and Testnet (chainId: 51) with independent configurations
- **Dynamic Endpoint Configuration**: Loads endpoints from ConfigService with runtime updates and automatic discovery
- **Primary Endpoint Tracking**: Maintains primary endpoint status with downtime detection and alert state management
- **Best Endpoint Selection**: Automatically selects endpoints with highest block height for optimal data reliability

### Data Structures and State Management

- **Time Window Data**: Efficient sliding window tracking for block times and transaction metrics with 24-hour windows
- **Endpoint Block Heights**: Real-time tracking of block heights per endpoint per network with automatic reset per cycle
- **Primary Endpoint Status**: Comprehensive downtime tracking with alert state management and automatic recovery detection
- **Network Configurations**: Centralized network configuration with RpcRetryClient management and fallback URL support

### Advanced Monitoring Features

- **Parallel Endpoint Checking**: Simultaneous block height checks across all endpoints for efficient monitoring
- **Intelligent Alert Throttling**: Dual-layer throttling system preventing alert storms during prolonged sync issues
- **Sentinel Value Management**: Maintains Grafana visibility for failed endpoints through sentinel values
- **Comprehensive Error Handling**: Graceful degradation with detailed error context and automatic recovery mechanisms

## Configuration Options

### Core Configuration

- `enableBlockMonitoring`: Toggle feature on/off via ConfigService (default: true)
- `scanInterval`: Time between block checks (default: 15000ms)
- `BLOCKCHAIN.BLOCKS.DEFAULT_SCAN_INTERVAL_MS`: Default scan interval fallback (15000ms)
- `BLOCKCHAIN.BLOCKS.BLOCK_TIME_ERROR_THRESHOLD`: Block time threshold for alerts

### Timing Configuration

- `startupDelay`: Delay before starting monitoring (5000ms)
- `errorRecoveryDelay`: Delay before retrying after errors (10000ms)
- `initialScanDelay`: Delay for initial scan (3000ms)

### Alert Thresholds

- `ALERTS.THRESHOLDS.SYNC_LAG_ERROR_BLOCKS`: Warning threshold for block lag (100 blocks)
- `ALERTS.THRESHOLDS.SYNC_LAG_CRITICAL_BLOCKS`: Critical threshold for block lag (1000 blocks)
- `ALERTS.NOTIFICATIONS.THROTTLE_SECONDS.SYNC_BLOCKS_LAG`: Alert throttling period (3600 seconds - 1 hour)
- `DOWNTIME_NOTIFICATION_THRESHOLD_MS`: Primary endpoint downtime threshold (1 hour)

### Transaction Processing Configuration

- `DEFAULT_BATCH_SIZE`: Default transaction batch size (20 transactions)
- `ADAPTIVE_BATCH_SIZE`: Large volume batch size (50 transactions for blocks with 500+ transactions)
- `RECENT_BLOCKS_SAMPLE_SIZE`: Sample size for block time analysis
- `TRANSACTION_HISTORY_WINDOW_MS`: Time window for transaction history tracking (5 minutes)

### RPC Client Configuration

- **Endpoint Checking**: 1 retry, 500ms delay, 3-second timeout for block height checks
- **Primary Clients**: 5 retries, 1-second delay, 10-second timeout for block data processing
- **Fallback URLs**: Automatic fallback URL configuration for enhanced reliability
- **Connection Pooling**: Efficient RPC client reuse across monitoring cycles

## Integration Points

### Service Dependencies

- **BlockchainService**: Access to blockchain providers and block/transaction data retrieval with chain-specific methods
- **ConfigService**: Configuration values for monitoring behavior, endpoint management, and runtime updates
- **RpcMonitorService**: Coordination with RPC endpoint health monitoring via `getAllRpcStatuses()` for intelligent endpoint selection
- **MetricsService**: Reports block metrics to InfluxDB including block heights, transaction counts, and timing data with sentinel value support
- **AlertService**: Sends alerts for sync lag, downtime, and other detected issues with chain-specific routing
- **SchedulerRegistry**: Manages monitoring intervals with proper cleanup and dynamic interval updates

### External Integrations

- **InfluxDB Metrics**: Writes comprehensive block height, transaction, and timing metrics with endpoint tagging
- **Grafana Dashboards**: Provides data for block monitoring visualizations with variance calculations and time window statistics
- **Telegram Alerts**: Sends critical alerts through AlertService integration with network-specific routing

## API Endpoints

### Monitoring Endpoints

- `/monitoring/block-status`: Returns detailed block monitoring information including:
  - Monitoring enabled status and scan intervals
  - Primary endpoints for each network with automatic best endpoint selection
  - Block time thresholds and comprehensive timing statistics
  - Monitored endpoints and their real-time status with chain ID filtering
  - Block height variance calculations between endpoints
  - Block time statistics with min/max/average/latest values and sample counts
- `/monitoring/block-comparison`: Shows block height differences between endpoints with calculated variances and network separation

### Response Data Structures

- **BlockMonitoringInfo**: Comprehensive monitoring status with network-specific data and endpoint intelligence
- **Block Time Statistics**: Count, average, min, max, and latest block times with sliding window analysis
- **RPC Status Maps**: Boolean status mapping for each endpoint by network with real-time health assessment
- **Block Height Variance**: Calculated variance between highest and lowest endpoints for sync monitoring

## Data Structures and Types

### Core Data Types

- **TimeWindowData**: Efficient sliding window tracking for block times and transaction data with 24-hour windows
- **NetworkConfig**: Network configuration including endpoints, clients, chain IDs, and primary endpoint management
- **BlockInfo**: Block data including height, timestamp, hash, and comprehensive transaction information
- **BlockMonitoringInfo**: Comprehensive monitoring status for API responses with variance calculations
- **PrimaryEndpointStatus**: Downtime tracking with alert state and automatic recovery detection for primary endpoints

### Utility Classes

- **RpcRetryClient**: Resilient RPC client with automatic failover, configurable retry mechanisms, and timeout management
- **SchedulerRegistry**: Advanced interval management with proper cleanup and dynamic updates

## Key Features and Capabilities

### Multi-Endpoint Monitoring

- **Comprehensive Endpoint Tracking**: Monitors all configured HTTP RPC endpoints per network with parallel processing
- **Real-time Block Height Comparison**: Tracks block heights across endpoints to identify discrepancies with variance calculation
- **Best Endpoint Selection**: Automatically selects endpoint with highest block height for data processing and reliability
- **Endpoint Health Integration**: Coordinates with RpcMonitorService for comprehensive health assessment and intelligent selection

### Intelligent Failover and Recovery

- **Automatic Primary Endpoint Switching**: Switches to healthy endpoints when primary endpoints fail with seamless transitions
- **Comprehensive Downtime Tracking**: Tracks endpoint downtime with 1-hour alert threshold and detailed status management
- **Graceful Error Handling**: Continues monitoring with fallback endpoints during failures with automatic recovery detection
- **Recovery Detection**: Automatically resets status when endpoints come back online with proper state management

### Adaptive Transaction Analysis

- **Dynamic Batch Processing**: Automatically adjusts batch size based on transaction volume (20 for normal blocks, 50 for high-volume blocks with 500+ transactions)
- **Parallel Transaction Processing**: Processes transaction batches in parallel for efficiency with Promise.allSettled pattern
- **Transaction Status Verification**: Verifies individual transaction success/failure status with comprehensive error handling
- **Comprehensive Transaction Metrics**: Tracks confirmed, failed, and total transaction counts per block with detailed logging

### Sliding Window Analysis

- **24-Hour Block Time Windows**: Maintains rolling windows of block times for trend analysis with automatic cleanup
- **Transaction History Tracking**: Tracks transaction counts and failure rates over time with configurable windows
- **Statistical Analysis**: Provides min, max, average, and latest values for block times with comprehensive sample tracking
- **Memory-Efficient Storage**: Automatically cleans up old data points to prevent memory leaks with optimized window management

### Resilient Initialization and Configuration

- **Staggered Startup**: Prevents resource spikes with configurable initialization delays (5s startup, 3s initial scan)
- **Dynamic Configuration Updates**: Runtime configuration updates without service restart with automatic endpoint discovery
- **Endpoint Discovery**: Automatically discovers and configures endpoints from ConfigService with chain ID filtering
- **Fallback Mechanisms**: Provides fallback data when primary systems are unavailable with comprehensive error recovery

### Sophisticated Sync Lag Detection

- **Dual-Threshold Alert System**: Warning alerts for 100-999 blocks behind, critical alerts for 1000+ blocks behind with intelligent categorization
- **Intelligent Alert Aggregation**: Groups multiple lagging endpoints into single comprehensive alerts to reduce notification noise
- **Detailed Endpoint Information**: Provides specific block heights and lag amounts for each affected endpoint with sorting by severity
- **Smart Alert Limiting**: Shows top 5 affected endpoints with summary for additional endpoints to prevent message overflow
- **Dual-Layer Throttling**: Primary throttling in BlocksMonitorService plus secondary throttling in AlertService using shared configuration (1-hour throttle period)
- **Severity-Based Alerting**: Sends warning and error alerts through AlertService with appropriate severity levels and chain-specific routing

### Comprehensive Metrics and Monitoring

- **Block Height Metrics**: Records block heights with endpoint and chain ID tags plus sentinel values for failed endpoints
- **Block Time Tracking**: Measures and records time between consecutive blocks with validation for positive values
- **Transaction Metrics**: Detailed transaction counts by status (total, confirmed, failed) with per-block tracking
- **Transactions Per Minute**: Calculates and tracks transaction throughput rates using sliding window data
- **Block Height Variance**: Real-time calculation of variance between endpoints for sync monitoring and health assessment
- **Endpoint Status Tracking**: Maintains real-time status of all monitored endpoints with comprehensive health data

### Error Handling and Resilience

- **Graceful Degradation**: Continues operation even when some endpoints fail with automatic fallback mechanisms
- **Comprehensive Error Logging**: Detailed logging for debugging and troubleshooting with performance timing
- **Fallback Data Provision**: Provides fallback monitoring info when primary data is unavailable through createFallbackMonitoringInfo
- **Exception Safety**: Proper exception handling prevents service crashes with comprehensive try-catch blocks
- **Resource Cleanup**: Proper cleanup of intervals and resources on shutdown through SchedulerRegistry management

## Monitoring Workflow

### Initialization Phase

1. **Service Initialization**: Initialize time windows, load configuration, and set up networks with SUPPORTED_CHAINS
2. **RPC Client Setup**: Create resilient RPC clients with retry mechanisms for each network with parallel connection testing
3. **Endpoint Discovery**: Discover and configure all available RPC endpoints from ConfigService with chain ID filtering
4. **Initial Block Height Scan**: Scan all endpoints to establish baseline block heights with parallel processing
5. **Best Endpoint Selection**: Select optimal endpoints based on initial scan results and update network configurations

### Runtime Monitoring Cycle

1. **Multi-Endpoint Scanning**: Check block heights across all configured endpoints with parallel processing and error isolation
2. **Best Endpoint Identification**: Identify endpoint with highest block height per network for data processing
3. **Block Data Processing**: Fetch and process latest block data from best endpoints with current and previous block analysis
4. **Adaptive Transaction Analysis**: Analyze transactions within blocks with dynamic batch processing based on volume
5. **Metrics Recording**: Record comprehensive metrics to InfluxDB for dashboard visualization including variance calculations
6. **Sync Lag Detection**: Check for endpoints significantly behind using dual-threshold system and trigger appropriate alerts
7. **Status Updates**: Update endpoint status and prepare for next monitoring cycle with automatic recovery detection

### Alert and Recovery Workflow

1. **Sync Lag Detection**: Identify endpoints behind by 100+ (warning) or 1000+ (critical) blocks with intelligent categorization
2. **Alert Aggregation**: Group multiple lagging endpoints into comprehensive alerts with endpoint details and severity classification
3. **Dual-Layer Throttling**: Apply primary throttling in BlocksMonitorService plus secondary throttling in AlertService
4. **Downtime Tracking**: Track primary endpoint downtime and alert after 1-hour threshold with detailed timing information
5. **Recovery Detection**: Automatically reset alert states when endpoints recover with proper status management

## Performance Optimizations

### Efficient Processing

- **Parallel Endpoint Checking**: Check multiple endpoints simultaneously for faster scanning with individual error handling
- **Adaptive Batch Sizing**: Dynamically adjust transaction batch sizes based on volume (20 default, 50 for high-volume blocks)
- **Memory-Efficient Windows**: Use sliding windows with automatic cleanup for time-series data and optimized storage
- **Optimized Metrics Writing**: Batch metrics writes to reduce InfluxDB load with sentinel value management

### Resource Management

- **Configurable Timeouts**: Short timeouts (3 seconds) for endpoint health checks and longer timeouts (10 seconds) for data processing
- **Connection Pooling**: Reuse RPC clients across monitoring cycles with proper lifecycle management
- **Graceful Shutdown**: Proper cleanup of resources and intervals through SchedulerRegistry
- **Error Recovery**: Automatic recovery from transient failures without service restart with comprehensive error handling

### Advanced Optimizations

- **Intelligent Client Management**: Different RPC client configurations for health checks vs data processing
- **Parallel Block Processing**: Simultaneous processing of current and previous blocks for block time calculation
- **Efficient Data Structures**: Optimized data structures for endpoint block heights and status tracking
- **Smart Error Isolation**: Individual endpoint failures don't cascade to other endpoints with proper error boundaries

## Testing and Debugging

### Logging and Observability

- **Comprehensive Debug Logging**: Detailed logging for all monitoring activities including block processing and transaction analysis
- **Performance Metrics**: Built-in latency and performance tracking with timing measurements
- **Error Context**: Rich error context for troubleshooting issues with endpoint and chain information
- **Status Reporting**: Real-time status reporting through API endpoints with comprehensive monitoring data

### Monitoring Health

- **Service Status API**: Check if block monitoring is enabled and functioning with detailed configuration information
- **Endpoint Status Tracking**: Monitor health of all configured endpoints with real-time status and variance data
- **Block Height Variance**: Track synchronization between endpoints with calculated variance and network analysis
- **Alert History**: Track alert frequency and patterns for optimization with dual-layer throttling visibility

### Enhanced Debugging Features

- **Transaction Processing Logs**: Detailed logs of batch processing with transaction counts and timing
- **Sync Lag Analysis**: Comprehensive logging of sync lag detection with threshold analysis and endpoint categorization
- **Primary Endpoint Management**: Detailed tracking of primary endpoint changes and downtime with recovery detection
- **Variance Calculation Tracking**: Real-time variance calculation logging with endpoint comparison data
