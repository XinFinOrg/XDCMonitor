# Blocks Monitor

## Purpose and Responsibilities

The Blocks Monitor service monitors blocks across XDC networks (Mainnet and Testnet). It tracks block heights, transaction counts, and block time intervals using resilient RPC clients with automatic failover capabilities.

## Core Workflows

1. **Block Height Monitoring**: Tracks block heights across all configured endpoints and identifies discrepancies
2. **Block Time Analysis**: Measures time between blocks within 24-hour sliding windows to detect network slowdowns
3. **Transaction Processing**: Analyzes transaction success/failure rates within blocks for network health metrics
4. **Endpoint Failover**: Automatically switches to healthy endpoints when the primary endpoint fails
5. **Alerting**: Sends alerts when block times exceed thresholds or endpoints experience downtime

## Configuration Options

- `enableBlockMonitoring`: Toggle feature on/off via ConfigService
- `scanInterval`: Time between block checks (defaults to 15000ms)
- `startupDelay`, `errorRecoveryDelay`, `initialScanDelay`: Timing parameters for graceful initialization
- Network configurations for Mainnet (`chainId: 50`) and Testnet (`chainId: 51`) endpoints

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
