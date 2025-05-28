# RPC Monitor

## Purpose and Responsibilities

The RPC Monitor service monitors the health and performance of XDC RPC endpoints, WebSocket connections, and related services. It implements sophisticated testing strategies including port monitoring, latency tracking, and adaptive check frequencies based on endpoint health. The system includes intelligent dynamic RPC endpoint selection for optimal blockchain service reliability and comprehensive peer count monitoring with adaptive baselines.

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

- **Generic Endpoint Monitoring**: Uses a unified `monitorEndpoints` function to handle both RPC and WebSocket endpoints with the same core logic
- **Intelligent Endpoint Classification**: Employs utility functions like `isWebSocketEndpoint` and `parseEndpointUrl` to reduce code duplication
- **Enhanced WebSocket Testing**: Features comprehensive error handling, proper resource cleanup, and SafeResolve pattern to prevent memory leaks
- **Unified Peer Count Integration**: Implements centralized peer count monitoring through the `monitorPeerCount` utility
- **RPC Selector Integration**: Provides real-time health data to RpcSelectorService for dynamic endpoint selection
- **Advanced Sync Monitoring**: Enhanced block height comparison and lag detection across all endpoints with cross-endpoint analysis
- **Staggered Initialization**: Prevents resource spikes by spacing out initial endpoint checks with configurable delays
- **Batch Processing with Prioritization**: Processes endpoints in configurable parallel batches with down endpoints prioritized for faster recovery detection

### Peer Count Monitor Service

The `PeerCountMonitor` provides sophisticated peer count monitoring with adaptive baselines and intelligent alerting:

- **Adaptive Baseline Calculation**: Dynamically calculates peer count baselines based on historical data with exponential decay
- **Multi-Threshold Alert System**: Uses both relative (40%/70% drops) and absolute thresholds for different severity levels
- **Consecutive Zero Detection**: Identifies and alerts on consecutive zero-peer readings with configurable thresholds
- **Exponential Backoff Alerting**: Implements intelligent alert throttling to prevent notification storms
- **Network Classification**: Differentiates between high-peer and low-peer endpoints for appropriate threshold scaling
- **Statistical Anomaly Detection**: Identifies significant deviations from established baselines using proportional thresholds
- **Historical High Tracking**: Maintains records of highest observed peer counts for context in alerts
- **Endpoint Type Support**: Handles both HTTP RPC and WebSocket endpoints with unified monitoring logic

## Core Workflows

### 1. Dynamic RPC Selection Workflow

The primary workflow for selecting optimal endpoints with comprehensive health assessment:

- **Continuous Health Data Collection**: RpcMonitorService feeds real-time health metrics to RpcSelectorService including latency, success rates, and sync status
- **Multi-Factor Quality Assessment**: Endpoints are automatically classified and scored based on performance using weighted criteria (latency 40%, success rate 30%, sync status 20%, quality tier 10%)
- **Intelligent Selection Algorithm**: Advanced scoring system considers multiple factors for optimal endpoint selection
- **Protected Failover**: Automatic failover when current primary has issues or better alternatives are available with minimum 5-minute intervals between switches
- **Sync Status Integration**: Block height synchronization status as a key factor in endpoint selection decisions

### 2. Comprehensive RPC Endpoint Monitoring

Advanced HTTP/HTTPS JSON-RPC endpoint testing with multiple verification strategies:

- **Dual Verification Methods**:
  - Primary: BlockchainService providers for efficient validation with existing connections
  - Fallback: Direct RPC calls through RpcRetryClient with configurable retry mechanisms and timeouts
- **Performance Metrics**: Latency measurement with threshold-based alerting (warning and error levels)
- **Health Data Integration**: Results automatically fed to RpcSelectorService for intelligent endpoint selection
- **Batch Processing**: Configurable parallel processing with individual error handling per endpoint
- **Priority-Based Checking**: Down endpoints checked first to detect recovery faster
- **Sentinel Value Management**: Maintains endpoint visibility in Grafana through sentinel values for failed endpoints

### 3. Enhanced WebSocket Monitoring

Optimized WebSocket connection handling with comprehensive error management:

- **SafeResolve Pattern**: Prevents memory leaks and duplicate state transitions with proper cleanup
- **Timeout Management**: Configurable timeouts (5 seconds) to prevent hanging connections
- **Multiple Verification Strategies**:
  - Active connection testing with real WebSocket handshakes
  - BlockchainService integration for existing provider status
- **Resource Cleanup**: Proper WebSocket termination and resource management
- **Error Context Tracking**: Detailed error logging for troubleshooting connection issues

### 4. Intelligent Port Monitoring

Unified port availability checking with optimized URL parsing:

- **Universal URL Parsing**: Handles both HTTP and WebSocket URLs with automatic port detection
- **Protocol-Aware Testing**: Different strategies for HTTP vs WebSocket port testing
- **Connection Validation**: TCP-level connectivity verification independent of service availability
- **Timeout Controls**: Configurable timeouts (5 seconds) for port availability checks

### 5. Service Infrastructure Monitoring

Comprehensive monitoring of related blockchain infrastructure services:

- **Explorer Service Monitoring**: HTTP-based health checks for blockchain explorers with status code validation
- **Faucet Service Monitoring**: Availability testing for testnet faucet services
- **Service Group Processing**: Parallel processing of service groups with aggregate reporting
- **Status Code Validation**: Accepts 2xx-4xx status codes as "up" to handle various service response patterns

### 6. Advanced Block Height Sync Monitoring

Enhanced synchronization monitoring with cross-endpoint analysis:

- **Cross-Endpoint Comparison**: Compares block heights across all active endpoints to identify network state
- **Lag Detection with Context**: Identifies endpoints falling behind with specific block count differences
- **Sync Status Updates**: Feeds synchronization information to RpcSelectorService for intelligent selection
- **Threshold-Based Classification**: Uses configurable thresholds to determine sync status (default: 50 blocks)
- **Chain-Specific Analysis**: Separate analysis for Mainnet (chainId: 50) and Testnet (chainId: 51)

### 7. Adaptive Monitoring System

Dynamic monitoring frequency adjustment based on endpoint health:

- **Health Factor Calculation**: Real-time calculation based on endpoint availability percentages
- **Frequency Scaling**: Automatic adjustment between minimum (15s) and maximum (2m) intervals
- **Endpoint-Specific Adaptation**: More frequent checks for problematic endpoints, less frequent for healthy ones
- **Resource Optimization**: Prevents unnecessary resource usage while maintaining responsiveness

### 8. Intelligent Batch Processing

Optimized endpoint checking with prioritization and resource management:

- **Configurable Batch Sizes**: Separate batch sizes for RPC (3) and WebSocket (2) endpoints
- **Priority-Based Ordering**: Down endpoints checked first for faster recovery detection
- **Parallel Processing**: Individual error handling within batches to prevent cascade failures
- **Inter-Batch Delays**: Configurable delays (500ms) between batches to prevent resource spikes
- **Progress Tracking**: Detailed logging of batch processing progress for monitoring

### 9. Comprehensive Peer Count Monitoring

Advanced peer count analysis with adaptive baselines and intelligent alerting:

- **Dynamic Baseline Establishment**: Requires minimum 5 samples before establishing reliable baselines
- **Gradual Baseline Adjustment**: 10% weight to new samples for responsive but stable baselines
- **Multi-Threshold Alert System**:
  - **Zero Peers**: Critical alerts after 3 consecutive zero readings
  - **Relative Drops**: 40% drop (significant) and 70% drop (critical) from baseline
  - **Absolute Drops**: Minimum 4 peers or 20% of baseline for significance
  - **High-Peer Endpoints**: Special handling for endpoints with 2x baseline or 8+ peers
- **Exponential Backoff**: Alert throttling starting at 30 minutes, doubling with each subsequent alert
- **Alert History Management**: 24-hour retention of alert history for intelligent throttling

## Configuration Options

### Core Monitoring Configuration

- `enableRpcMonitoring`: Toggle monitoring on/off via ConfigService (default: true)
- `enablePortMonitoring`: Toggle port monitoring functionality

### Interval Settings (Environment Variables)

- `RPC_CHECK_INTERVAL_MS`: RPC endpoint check interval (default: 30000ms)
- `WS_CHECK_INTERVAL_MS`: WebSocket check interval (default: 30000ms)
- `PORT_CHECK_INTERVAL_MS`: Port check interval (default: 30000ms)
- `SERVICE_CHECK_INTERVAL_MS`: Service check interval (default: 60000ms)
- `SYNC_INTERVAL_MS`: Blockchain service sync interval (default: 60000ms)
- `VISIBILITY_CHECK_INTERVAL_MS`: Endpoint visibility check interval (default: 300000ms - 5 minutes)

### Batch Processing Configuration

- `RPC_CHECK_BATCH_SIZE`: Number of RPC endpoints to check in parallel (default: 3)
- `WS_CHECK_BATCH_SIZE`: Number of WebSocket endpoints to check in parallel (default: 2)
- `BATCH_DELAY_MS`: Delay between batches to prevent resource spikes (default: 500ms)

### Adaptive Monitoring Settings

- `ENABLE_ADAPTIVE_MONITORING`: Toggle adaptive monitoring (default: false)
- `MAX_CHECK_INTERVAL_MS`: Maximum interval for healthy endpoints (default: 120000ms - 2 minutes)
- `MIN_CHECK_INTERVAL_MS`: Minimum interval for problematic endpoints (default: 15000ms)

### Alert and Performance Thresholds

- `DOWNTIME_NOTIFICATION_THRESHOLD_MS`: Threshold for downtime alerts (60 minutes)
- `ALERTS.THRESHOLDS.RPC_LATENCY_WARNING_MS`: Warning threshold for RPC latency
- `ALERTS.THRESHOLDS.RPC_LATENCY_ERROR_MS`: Error threshold for RPC latency
- `blockDiscrepancySyncThreshold`: Maximum blocks behind to consider synced (default: 50)

### RPC Selector Configuration

Internal configuration constants for the RpcSelectorService:

- **Minimum Switch Interval**: 5 minutes (300,000ms) to prevent rapid endpoint toggling
- **Good Latency Threshold**: 1000ms for considering an endpoint performant
- **Maximum Blocks Behind**: 50 blocks for considering an endpoint in sync
- **Quality Tier Thresholds**:
  - HIGH: 95%+ success rate with good latency and sync status
  - MEDIUM: 85%+ success rate with acceptable performance
  - LOW: Assigned after 3+ consecutive failures

### Peer Count Monitor Configuration

Internal constants for adaptive peer count monitoring:

- **Baseline Requirements**: Minimum 5 samples for valid baseline establishment
- **Alert Thresholds**:
  - Significant relative drop: 40% below baseline
  - Critical relative drop: 70% below baseline
  - Minimum absolute drop: 4 peers or 20% of baseline
  - High-peer threshold: 2x baseline or minimum 8 peers
- **Alert Management**:
  - Initial backoff: 30 minutes
  - Consecutive zeros threshold: 3 readings
  - Alert history retention: 24 hours
  - Exponential backoff multiplier: 2x per alert

## Integration Points

### Service Dependencies

- **BlockchainService**:
  - Access to blockchain providers and client management
  - Integration with RpcSelectorService for dynamic endpoint selection
  - Provider status synchronization and block height retrieval
  - WebSocket provider management and status updates
- **ConfigService**:
  - Retrieves endpoint configurations and environment variables
  - Provides monitoring configuration and thresholds
  - Supplies RPC, WebSocket, explorer, and faucet endpoint lists
- **MetricsService**:
  - Reports detailed endpoint metrics including latency, availability, and peer counts
  - Maintains endpoint visibility through sentinel values
  - Records RPC status, WebSocket status, latency, and peer count metrics
- **AlertService**:
  - Sends alerts for extended downtime (1-hour threshold)
  - Handles sync lag alerts and peer count anomalies
  - Manages alert throttling and severity levels
- **RpcSelectorService Integration**:
  - **Bidirectional Health Data Flow**: RpcMonitorService feeds real-time health metrics
  - **Sync Status Updates**: Block height synchronization information continuously updated
  - **Performance Metrics**: Latency and success rate data for quality assessment
  - **Endpoint Selection Influence**: RpcSelectorService influences monitoring priorities

### External Integrations

- **InfluxDB Metrics**: Comprehensive metrics storage for dashboards and alerting
- **Grafana Dashboards**: Real-time visualization of endpoint health and performance
- **Telegram Alerts**: Critical alerts through AlertService integration for downtime and peer count issues

## API Endpoints

### RPC Selection and Health Endpoints

- `/api/monitoring/rpc/health`: Returns comprehensive health metrics for all RPC endpoints across all networks
- `/api/monitoring/rpc/health/:chainId`: Returns health metrics for endpoints on a specific chain (50=Mainnet, 51=Testnet)
- `/api/monitoring/rpc/primary`: Returns currently selected primary RPC endpoints for all networks
- `/api/monitoring/rpc/primary/:chainId`: Returns the currently selected primary RPC endpoint for a specific chain
- `/api/monitoring/rpc/status`: Returns comprehensive status information for all monitored endpoints

### Traditional Monitoring Endpoints

- `/monitoring/websocket-status`: Returns WebSocket connection status for all monitored endpoints

### Programmatic Access Methods

- `getAllRpcStatuses()`: Returns detailed status of all RPC endpoints including latency and chain ID
- `getAllWsStatuses()`: Returns status of all WebSocket endpoints with chain ID information
- `getAllExplorerStatuses()`: Returns status mapping of all explorer services
- `getAllFaucetStatuses()`: Returns status mapping of all faucet services
- `getAnyWsStatus()`: Returns overall WebSocket connectivity status ('up' if any WebSocket is active)

## Status Tracking and Data Structures

### Enhanced Multi-Dimensional Status Management

- **Comprehensive Health Tracking**: Combines traditional up/down status with detailed health metrics
- **Quality Tier Evolution**: Automatic promotion/demotion based on consistent performance patterns
- **Exponential Decay Metrics**: Recent performance weighted more heavily than historical data
- **Sync Status Integration**: Block height synchronization status as a key health factor
- **Performance History**: Detailed tracking of success rates, latency trends, and reliability patterns

### Status Data Structures

- **EndpointStatus**: Core status tracking with latency, downtime, and alert state
- **ServiceStatus**: Simplified status tracking for explorer and faucet services
- **PeerCountBaseline**: Comprehensive peer count tracking with adaptive baselines
- **RpcMonitorConfig**: Complete configuration structure with all monitoring parameters

### Traditional Status Tracking Features

- **Sophisticated Status Maps**: Track uptime/downtime with precise timestamps
- **Latency Performance Analysis**: Real-time latency tracking for performance analysis
- **Health Factor Calculations**: Endpoint availability percentages for dashboard metrics
- **Downtime Notification Management**: Configurable thresholds with alert state tracking
- **Status Transition Handling**: Proper state management for up/down transitions

## Key Features and Capabilities

### Advanced Dynamic Selection Features

- **Intelligent Multi-Factor Endpoint Selection**: Comprehensive algorithm considering latency, success rate, sync status, and quality tier
- **Automatic Quality Tier Classification**: Performance-based categorization with historical analysis
- **Self-Healing Infrastructure**: Automatic adaptation to network conditions and endpoint issues
- **Real-Time Sync Status Monitoring**: Continuous block height synchronization tracking across endpoints
- **Performance-Based Failover**: Automatic switching based on comprehensive health assessment
- **Switch Interval Protection**: Prevents rapid endpoint switching with configurable minimum intervals
- **Continuous Health Updates**: Real-time health metric updates for responsive endpoint selection

### Comprehensive Monitoring Features

- **Multi-Method RPC Verification**:
  - Primary verification through BlockchainService providers
  - Fallback verification through direct RPC calls with retry mechanisms
- **Optimized WebSocket Testing**:
  - SafeResolve pattern preventing memory leaks
  - Proper resource cleanup and timeout management
- **Staggered Service Initialization**: Prevents resource spikes with configurable startup delays
- **Parallel Batch Processing**: Configurable parallel processing with individual error handling
- **WebSocket Subscription Testing**: Real connection verification with proper cleanup
- **Port Availability Validation**: Network connectivity verification independent of service status
- **Service Health Metrics**: Comprehensive tracking of explorer and faucet service availability
- **Adaptive Check Frequencies**: Dynamic frequency adjustment based on endpoint health
- **Automatic Client Management**: RPC client creation and management with retry capabilities
- **Health Factor Calculation**: Overall health percentages for monitoring dashboards
- **Priority-Based Recovery Detection**: Faster recovery detection through prioritized checking
- **Memory Leak Prevention**: Proper resource cleanup, especially for WebSocket connections

### Advanced Peer Count Monitoring

- **Adaptive Baseline Management**: Dynamic baseline calculation with historical data analysis
- **Multi-Threshold Alert System**: Relative and absolute threshold calculations for different severity levels
- **Consecutive Zero Detection**: Intelligent detection of sustained zero-peer conditions
- **Exponential Backoff Alerting**: Sophisticated alert throttling to prevent notification storms
- **Network Classification**: Differentiated handling for high-peer vs low-peer endpoints
- **Statistical Anomaly Detection**: Proportional threshold scaling based on network characteristics
- **Historical High Tracking**: Context-aware alerting with peak peer count references
- **Endpoint Type Agnostic**: Unified monitoring for both HTTP RPC and WebSocket endpoints

### Sync Monitoring and Block Height Analysis

- **Cross-Endpoint Block Height Comparison**: Real-time comparison across all active endpoints
- **Chain-Specific Analysis**: Separate monitoring for Mainnet and Testnet networks
- **Sync Status Classification**: Configurable thresholds for determining synchronization status
- **RPC Selector Integration**: Sync status feeding into endpoint selection algorithms
- **Performance Context**: Block height lag as a factor in overall endpoint health assessment

### Error Handling and Resilience

- **Graceful Degradation**: Continued operation during partial endpoint failures
- **Comprehensive Error Logging**: Detailed error context for troubleshooting
- **Fallback Mechanisms**: Multiple verification strategies for robust monitoring
- **Exception Safety**: Proper exception handling preventing service crashes
- **Resource Management**: Automatic cleanup of connections and intervals
- **State Consistency**: Proper status transition handling for reliable state management

## Peer Count Monitoring Deep Dive

### Adaptive Baseline System

The peer count monitoring system uses sophisticated baseline calculation:

- **Initial Baseline Building**: Requires minimum 5 samples using weighted average calculation
- **Continuous Adaptation**: 10% weight to new samples for responsive but stable baselines
- **Historical High Tracking**: Maintains peak peer count for context in drop calculations
- **Endpoint Classification**: Automatically determines if endpoints typically have peers

### Multi-Threshold Alert Logic

The system uses multiple threshold types for comprehensive anomaly detection:

1. **Zero Peer Detection**: Critical alerts after 3 consecutive zero readings
2. **Relative Drop Thresholds**:
   - 40% drop from baseline: Significant alert
   - 70% drop from baseline: Critical alert
3. **Absolute Drop Thresholds**:
   - Minimum 4 peers or 20% of baseline for significance
   - 2x threshold for high-peer endpoints (8+ peers or 2x baseline)
4. **Critical Baseline Thresholds**: Special handling when baseline > 5 peers

### Alert Management and Throttling

- **Exponential Backoff**: Starting at 30 minutes, doubling with each subsequent alert
- **Alert History Retention**: 24-hour sliding window for intelligent throttling
- **Context-Aware Messaging**: Detailed alert messages with baseline and current values
- **Severity Classification**: Automatic severity assignment based on threshold type

### Integration with Main Monitoring

- **Unified Monitoring Calls**: Integrated into main RPC and WebSocket monitoring workflows
- **Sentinel Value Management**: Maintains Grafana visibility for failed peer count checks
- **Error Isolation**: Peer count failures don't affect main endpoint monitoring
- **Performance Optimization**: Cached RPC clients and efficient WebSocket handling

## Module Architecture and Dependencies

### Service Architecture

```typescript
@Injectable()
export class RpcMonitorService implements OnModuleInit, OnModuleDestroy {
  // Core dependencies
  private readonly blockchainService: BlockchainService;
  private readonly configService: ConfigService;
  private readonly metricsService: MetricsService;
  private readonly alertService: AlertService;
  private readonly peerCountMonitor: PeerCountMonitor;
  private readonly rpcSelectorService: RpcSelectorService;
}
```

### Module Integration Pattern

1. **RpcSelectorModule**: Provides core selection intelligence
2. **RpcModule**: Combines monitoring services with selection capability
3. **MonitoringModule**: Integrates RPC monitoring with broader monitoring system
4. **BlockchainModule**: Imports RpcSelectorModule for dynamic endpoint selection

### Lifecycle Management

- **OnModuleInit**: Proper service initialization with provider setup
- **OnModuleDestroy**: Clean shutdown with interval cleanup and resource management
- **Staggered Startup**: Prevents resource spikes with configurable initialization delays
- **Graceful Shutdown**: Proper cleanup of all intervals, timeouts, and connections

## Performance Optimizations and Best Practices

### Efficient Resource Management

- **Connection Pooling**: Reuse of RPC clients across monitoring cycles
- **Batch Processing**: Parallel processing with configurable batch sizes
- **Memory Management**: Proper cleanup of WebSocket connections and timeouts
- **Timeout Controls**: Short timeouts (3-5 seconds) for responsive monitoring

### Monitoring Efficiency

- **Priority-Based Checking**: Down endpoints checked first for faster recovery
- **Adaptive Frequencies**: Dynamic interval adjustment based on health status
- **Sentinel Value Strategy**: Maintains Grafana visibility without excessive data points
- **Error Isolation**: Individual endpoint failures don't cascade to other endpoints

### Alert Optimization

- **Intelligent Throttling**: Exponential backoff prevents alert storms
- **Context-Aware Messaging**: Detailed but concise alert information
- **Severity Classification**: Appropriate alert levels based on impact
- **Historical Context**: Baseline and peak values for meaningful alerts

## Testing and Debugging

### Comprehensive Logging

- **Debug Level Logging**: Detailed operation logging for troubleshooting
- **Performance Metrics**: Built-in latency and success rate tracking
- **Error Context**: Rich error information with endpoint and operation details
- **Status Transition Logging**: Clear logging of up/down state changes

### Monitoring Health

- **Service Status APIs**: Real-time status reporting through multiple endpoints
- **Health Factor Calculation**: Quantitative health assessment for each endpoint type
- **Batch Processing Visibility**: Detailed logging of batch operations and progress
- **Resource Usage Tracking**: Memory and connection usage monitoring

### Troubleshooting Tools

- **Endpoint Classification**: Clear identification of HTTP vs WebSocket endpoints
- **URL Normalization**: Consistent URL handling for reliable matching
- **Status Map Inspection**: Direct access to internal status tracking
- **Configuration Validation**: Runtime configuration verification and reporting
