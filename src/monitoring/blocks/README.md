# Blocks Monitor

## Purpose and Responsibilities

The Blocks Monitor service monitors blocks across XDC networks (Mainnet and Testnet). It tracks block heights, transaction counts, and block time intervals using resilient RPC clients with automatic failover capabilities.

## Core Workflows

1. **Block Height Monitoring**: Tracks block heights across all configured endpoints and identifies discrepancies
2. **Block Time Analysis**: Measures time between blocks within 24-hour sliding windows to detect network slowdowns
3. **Transaction Processing**: Analyzes transaction success/failure rates within blocks for network health metrics
4. **Endpoint Failover**: Automatically switches to healthy endpoints when the primary endpoint fails
5. **Alerting**: Sends alerts when block times exceed thresholds or endpoints experience downtime
6. **Sync Blocks Lag Detection**: Identifies and alerts when endpoints fall significantly behind in block height

## Configuration Options

- `enableBlockMonitoring`: Toggle feature on/off via ConfigService
- `scanInterval`: Time between block checks (defaults to 15000ms)
- `startupDelay`: Delay before starting monitoring (defaults to 5000ms)
- `errorRecoveryDelay`: Delay before retrying after errors (defaults to 10000ms)
- `initialScanDelay`: Delay for initial scan (defaults to 3000ms)
- Network configurations for Mainnet (`chainId: 50`) and Testnet (`chainId: 51`) endpoints
- Alert thresholds:
  - `SYNC_LAG_ERROR_BLOCKS`: Warning threshold for block lag (defaults to 100 blocks)
  - `SYNC_LAG_CRITICAL_BLOCKS`: Critical threshold for block lag (defaults to 1000 blocks)

## Integration Points

- **BlockchainService**: Access to blockchain providers and RPC clients
- **ConfigService**: Configuration values for monitoring behavior
- **RpcMonitorService**: Status of RPC endpoints for coordinated monitoring
- **MetricsService**: Reports block metrics for dashboards
- **AlertService**: Sends alerts on detected issues
- **SchedulerRegistry**: Manages monitoring intervals

## API Endpoints

- `/monitoring/block-status`: Returns detailed block monitoring information
- `/monitoring/block-comparison`: Shows block height differences between endpoints with calculated variances

## Data Structures

- `TimeWindowData`: Tracks rolling windows of block times and transaction data
- `NetworkConfig`: Stores network configuration including endpoints and clients
- `BlockInfo`: Contains block data including height, timestamp, and transaction info
- `BlockMonitoringInfo`: Comprehensive monitoring status for API responses
- `RpcRetryClient`: Resilient RPC client with automatic failover and retry capabilities

## Key Features

- **Multi-endpoint Monitoring**: Tracks multiple RPC endpoints per network to identify discrepancies
- **Automatic Failover**: Switches to healthy endpoints when primary endpoints fail
- **Transaction Analysis**: Analyzes transaction success rates within blocks
- **Sliding Window Analysis**: Maintains 24-hour windows of block times for trend analysis
- **Resilient Initialization**: Graceful startup with configurable delays
- **Health Metrics**: Comprehensive metrics for block times, processing rates, and endpoint health
- **Batch Transaction Processing**: Efficient processing of transactions in configurable batches
- **Dynamic Configuration**: Runtime configuration updates without service restart
- **Sync Blocks Lag Detection**: Identifies endpoints that are behind in block height compared to the network's highest block
  - Warning alerts for endpoints 100-999 blocks behind
  - Critical alerts for endpoints 1000+ blocks behind
  - Intelligent alert aggregation to reduce notification noise
  - Limits detailed information to top 5 affected endpoints
  - Adaptive throttling based on the number of affected endpoints
