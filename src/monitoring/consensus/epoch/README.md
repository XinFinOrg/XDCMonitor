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

| Configuration              | Description                                 | Value          |
| -------------------------- | ------------------------------------------- | -------------- |
| penaltyThresholdPercentage | Percentage threshold for frequent penalties | 70%            |
| maxPenaltyListSize         | Maximum allowed penalty list size           | 20             |
| monitoringIntervalMs       | Monitoring interval in milliseconds         | 300000 (5 min) |
| slidingWindowSize          | Number of epochs to keep in sliding window  | 10             |
