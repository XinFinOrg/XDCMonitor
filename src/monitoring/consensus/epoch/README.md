# XDC Epoch Monitor

The Epoch Monitor is responsible for tracking and monitoring XDC blockchain epoch transitions, masternode list updates, and validator penalties using a sliding window approach.

## Features

### 1. Sliding Window Penalty Tracking

- Maintains a sliding window of the last 10 epochs (configurable)
- Tracks which nodes appear in the penalty list for each epoch
- Automatically removes older epochs as new ones arrive
- Memory-efficient array-based tracking with no database dependency

### 2. Penalty Frequency Detection

- Calculates how often validator nodes appear in the penalty list within the sliding window
- Tracks penalty frequency as a percentage of recent epochs (not all-time history)
- Alerts when nodes exceed a configurable penalty threshold (default: 70%)
- Only considers nodes with sufficient sample size (at least 5 epochs)
- Provides detailed alerts with full node addresses and exact penalty counts

### 3. Penalty List Size Monitoring

- Monitors the size of the penalty list in real-time
- Generates alerts if the penalty list becomes too large (default threshold: 20 nodes)
- Helps identify potential consensus issues in the network

## Implementation

The Epoch Monitor uses a simple, memory-efficient approach:

1. **Data Structure**: Maintains arrays of penalized addresses for each epoch
2. **Sliding Window**: Automatically drops oldest epochs when new ones arrive
3. **No Database Persistence**: All monitoring happens in-memory for better performance
4. **Event-Driven Updates**: Updates happen when epochs change, not on fixed intervals
5. **Chain-Specific Tracking**: Separate tracking for each monitored chain
6. **Orchestrated Operation**: Integrates with ConsensusMonitor for validator data access
7. **Sorted Epoch Tracking**: Maintains epochs in sorted order for optimized lookups

## Architecture Integration

The EpochMonitor is designed to work within the orchestrated consensus monitoring system:

1. **Data Flow**:

   - Relies on ConsensusMonitor as the source of validator and epoch data
   - Receives penalty list updates through the `updatePenaltyData` method
   - Called by ConsensusMonitor when validator data is refreshed

2. **Lifecycle Management**:

   - Exposes `monitorEpochPenalties` method for monitoring, but doesn't self-schedule
   - ConsensusMonitor manages the monitoring interval and triggers checks
   - Operates on a 5-minute interval for efficient resource usage

3. **Multi-Chain Support**:
   - Maintains separate penalty tracking state for each chain ID
   - Generates chain-specific alerts with appropriate network names (Mainnet/Testnet)

## Alerts

The Epoch Monitor generates the following detailed alerts:

### 1. Penalty List Size Alert

- **Trigger**: Penalty list size equals or exceeds threshold
- **Severity**: Warning
- **Type**: CONSENSUS_PENALTY_LIST_SIZE_EXCEEDED
- **Message**: `Chain {chainId} ({chainName}): Penalty list size ({size}) exceeds threshold ({threshold})`

### 2. Frequent Penalty Alert

- **Trigger**: Node appears in penalty list too frequently in recent epochs
- **Severity**: Warning
- **Type**: CONSENSUS_FREQUENT_PENALTY_NODES
- **Message**: Detailed alert including:
  - Chain ID and name (Mainnet/Testnet)
  - Count of frequently penalized nodes
  - Complete list of penalized nodes with:
    - Full node addresses (no shortening)
    - Exact count of epochs in penalty (e.g., "7/10 epochs")
    - Percentage of epochs in penalty (e.g., "70.0%")

## Configuration

The Epoch Monitor has the following hardcoded configuration values:

| Configuration              | Description                                 | Value         |
| -------------------------- | ------------------------------------------- | ------------- |
| penaltyThresholdPercentage | Percentage threshold for frequent penalties | 70%           |
| maxPenaltyListSize         | Maximum allowed penalty list size           | 20            |
| monitoringIntervalMs       | Monitoring interval in milliseconds         | 60000 (1 min) |
| slidingWindowSize          | Number of epochs to keep in sliding window  | 10            |

## Integration Points

- **ConsensusMonitor**: Source of validator data and epoch information
- **MetricsService**: Records statistics about penalty frequency and validator status
- **AlertService**: Generates alerts for large penalty lists and frequently penalized nodes

## Metrics Collection

The Epoch Monitor leverages the metrics provided by the ConsensusMonitor:

- **validator_summary**: Records counts of masternodes, standbynodes, and penalized nodes
- **validator_nodes**: Records individual validator status with address, status, and epoch

These metrics flow into Grafana dashboards for visualization and analysis.

## Key Features

- **Memory-Efficient Design**: Uses simple data structures with minimal memory footprint
- **Automatic Window Management**: Maintains optimal sliding window size as epochs progress
- **Percentage-Based Alerting**: Uses relative metrics (percentage of epochs) rather than absolute counts
- **Complete Address Recording**: Provides full addresses in alerts for easy identification
- **Adaptive Monitoring**: Updates only when new epoch data becomes available
- **Multi-Chain Support**: Maintains separate state for each monitored chain
- **Comprehensive Alert Context**: Includes detailed statistics in alerts for better context
- **Sorted Epoch Tracking**: Maintains epochs in sorted order for optimized lookups
- **Minimum Sample Size**: Only evaluates nodes with sufficient history (at least 5 epochs)
- **Targeted Alerting**: Generates alerts only for actionable issues
