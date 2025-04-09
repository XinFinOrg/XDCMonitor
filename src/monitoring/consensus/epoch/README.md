# XDC Epoch Monitor

The Epoch Monitor is responsible for tracking and monitoring XDC blockchain epoch transitions, masternode list updates, and validator penalties.

## Features

### 1. Masternode and Penalty Tracking

- Monitors the masternode set and penalty list across epochs
- Records historical data following time progression
- Leverages data from the `ConsensusMonitor` service

### 2. Penalty Frequency Detection

- Tracks how often validator nodes appear in the penalty list
- Calculates penalty frequency as a percentage of epochs
- Alerts when nodes exceed a configurable penalty threshold (default: 50%)
- Only considers nodes with sufficient sample size (at least 5 epochs)

### 3. Penalty List Size Monitoring

- Monitors the size of the penalty list
- Generates alerts if the penalty list becomes too large (default threshold: 10 nodes)
- Helps identify potential consensus issues in the network

## Configuration

The Epoch Monitor service can be configured through environment variables:

| Environment Variable           | Description                                 | Default        |
| ------------------------------ | ------------------------------------------- | -------------- |
| CONSENSUS_MONITORING_CHAIN_IDS | Chain IDs to monitor                        | [50, 51]       |
| PENALTY_THRESHOLD_PERCENTAGE   | Percentage threshold for frequent penalties | 50             |
| MAX_PENALTY_LIST_SIZE          | Maximum allowed penalty list size           | 20             |
| EPOCH_MONITOR_INTERVAL_MS      | Monitoring interval in milliseconds         | 300000 (5 min) |

## Metrics

Metrics are stored in InfluxDB with the following measurements:

### 1. `validator_penalty_frequency`

Records the frequency of penalties for each validator node:

- **Tags**:
  - `chainId`: Chain ID
  - `address`: Validator node address
  - `epoch`: Current epoch number
- **Fields**:
  - `frequency`: Percentage of epochs the node was in penalty (0-100%)

## Alerts

The Epoch Monitor generates the following alerts:

### 1. Penalty List Size Alert

- **Trigger**: Penalty list size exceeds threshold
- **Severity**: Warning
- **Type**: PENALTY_LIST_SIZE_EXCEEDED
- **Message**: `Chain {chainId}: Penalty list size ({size}) exceeds threshold ({threshold})`

### 2. Frequent Penalty Alert

- **Trigger**: Node appears in penalty list too frequently
- **Severity**: Warning
- **Type**: FREQUENT_PENALTY_NODES
- **Message**: `Chain {chainId}: {count} node(s) frequently penalized (>{threshold}% of epochs)`
