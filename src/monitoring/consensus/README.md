# Consensus Monitoring System

## Overview

This directory contains the XDC Consensus Monitoring System, which tracks and validates various aspects of the XDPoS 2.0 consensus mechanism across XDC networks.

## Architecture

The system follows a modular NestJS architecture with a central coordinator and specialized monitoring services:

### Module Structure

- **[ConsensusModule](./consensus.module.ts)** - NestJS module that encapsulates all consensus-related monitors
- **[ConsensusMonitor](./consensus.monitor.ts)** - Orchestrates the monitoring services and provides a unified interface
- **[Consensus Utilities](./consensus.utils.ts)** - Shared utilities for epoch detection, RPC client creation, and configuration

### Specialized Monitors

1. **[Miner Monitor](./miner/README.md)** - Tracks the round-robin mining pattern and timeout detection with complete block coverage ✅
2. **[Epoch Monitor](./epoch/README.md)** - Monitors epoch transitions and masternode list updates ✅
3. **[Reward Monitor](./reward/README.md)** - Validates reward distribution at epoch boundaries 🚧

### Orchestration Flow

The `ConsensusMonitor` acts as the orchestration service with a coordinated initialization flow:

1. First loads validator data for all chains
2. Only after data is available, initializes component monitors
3. Manages the monitoring intervals for all components
4. Provides a central access point for validator data

This approach ensures that all component monitors have access to the necessary validation data before they begin their monitoring activities, preventing race conditions.

## Multi-Chain Support

The consensus monitoring system supports monitoring multiple chains simultaneously:

- **Mainnet (Chain ID: 50)** - XDC Production Network
- **Testnet (Chain ID: 51)** - XDC Apothem Network

## Configuration Options

The monitoring system is configured via environment variables in two sections:

### Monitoring Features

```
# Monitoring features
ENABLE_RPC_MONITORING=true
ENABLE_BLOCK_MONITORING=true
ENABLE_PORT_MONITORING=true
ENABLE_CONSENSUS_MONITORING=true
```

### Consensus Specific Configuration

```
# Consensus monitoring configuration
CONSENSUS_MONITORING_CHAIN_IDS=50,51
CONSENSUS_SCAN_INTERVAL=15000
```

Configuration options:

- `ENABLE_CONSENSUS_MONITORING`: Enable/disable the consensus monitoring feature
- `CONSENSUS_MONITORING_CHAIN_IDS`: Comma-separated list of chain IDs to monitor (default: 50,51)
- `CONSENSUS_SCAN_INTERVAL`: Time between consensus checks in milliseconds (default: 15000ms)

Each chain maintains its own independent state, including:

- Current epoch information
- Masternode list
- Mining performance metrics
- Consensus violations

## Advanced Monitoring Features

### Complete Block Coverage

The monitoring system processes all blocks in each chain, not just the latest ones:

1. Tracks the last checked block number for each chain
2. Fetches all new blocks since the last check in efficient batches
3. Processes each block for consensus rule compliance

This approach ensures:

- No blocks are missed between monitoring cycles
- All consensus violations are detected
- Complete historical record of mining activity

### Blockchain Native APIs

The system leverages specialized XDC blockchain APIs for accurate monitoring:

- `XDPoS_getEpochNumbersBetween`: Precisely identifies epoch boundaries
- `XDPoS_getMasternodesByNumber`: Gets the canonical masternode list
- `XDPoS_getMissedRoundsInEpochByBlockNum`: Gets authoritative data about missed rounds

By using these native APIs instead of relying solely on our calculations, the monitoring system achieves higher accuracy and reliability.

## Key Features

- **Centralized Validator Management**: Central ConsensusMonitor service manages validator data for all monitors
- **Coordinated Initialization**: Orchestrated startup to ensure data availability before monitoring begins
- **Sliding Window Epoch Tracking**: Memory-efficient tracking of recent epochs with array-based storage
- **Dynamic Chain Detection**: Auto-detects supported chains based on configuration
- **Real-time Alert Generation**: Generates alerts for consensus rule violations
- **Complete Block Coverage**: Processes all blocks with batch fetching for complete monitoring
- **Penalty Detection**: Tracks which nodes appear in penalty lists with frequency analysis
- **Timeout Period Detection**: Identifies when miners fail to produce blocks within timeouts
- **InfluxDB Metrics**: Records detailed metrics for validator status, missed blocks, and timeouts
- **Violation Tracking**: Maintains history of recent consensus violations for analysis

## XDPoS 2.0 Consensus Details

### Masternode System

- **Masternode Qualification**: Requires staking more than 10,000,000 XDC to become a candidate
- **Node Categories**:
  - **Masternode**: Active block producers limited to 108 nodes
  - **Standbynode**: Qualified nodes beyond the 108 limit waiting to become active
  - **PenaltyNode**: Nodes that have been penalized for malicious behavior (offline, not mining)

### Epoch Structure

- Each epoch consists of approximately 900 blocks (not exactly 900 - it can vary slightly)
- The same masternode list is used throughout an epoch
- After each epoch:
  - A new masternode list is calculated
  - Rewards are distributed to the previous masternode list
  - Masternodes receive approximately 10% APY
  - Standbynodes receive approximately 7-8% APY

### Mining Process

- At the beginning of each epoch, the first block is mined by masternode at index 0
- Each subsequent block is mined by the next masternode in the list
- After reaching the end of the list (108 masternodes), it wraps back to index 0
- This creates a predictable round-robin sequence based on block position within the epoch

### Timeout Handling

- If a masternode fails to produce a block within 10 seconds, a timeout occurs
- The next masternode in the sequence takes over
- Our monitoring system detects these timeouts by:
  - Checking the timestamp difference between consecutive blocks
  - Verifying the difference exceeds the 10-second threshold
  - Confirming the actual miner is the next expected miner after the timeout

### Block Confirmation Process

1. Miner broadcasts the new block
2. Other masternodes verify the block
3. Masternodes sign to accept the block
4. Block is included in the blockchain if more than 2/3 of masternodes sign

### Masternode Data Access

Masternode and penalty information can be accessed via RPC:

```
curl --location 'https://rpc.xinfin.network' \
--header 'Content-Type: application/json' \
--data '{"jsonrpc":"2.0","method":"XDPoS_getMasternodesByNumber","params":["latest"],"id":1}'
```

Response includes:

- Current block number and round
- List of active masternodes (limited to 108)
- List of penalized nodes
- List of standby nodes

## Integration

All consensus monitoring services integrate with:

- **BlockchainService** - Access to blockchain data
- **ConfigService** - Configuration values
- **MetricsService** - Reporting monitoring metrics
- **AlertService** - Sending alerts on detected issues

## API Endpoints

The monitoring system exposes several API endpoints through the `MonitoringController`:

- `/monitoring/consensus-status` - Overall consensus monitoring status across chains
- `/monitoring/masternode-performance/:chainId` - Performance metrics for masternodes on a specific chain
- `/monitoring/consensus-violations/:chainId` - Detected consensus rule violations on a specific chain

## Epoch Monitor Details

The Epoch Monitor focuses specifically on tracking penalties across epoch transitions:

- **Sliding Window Approach**: Maintains data for the last 10 epochs in memory
- **Penalty Tracking**: Records which nodes appear in penalty lists in each epoch
- **Frequency Analysis**: Calculates how often nodes appear in penalty lists
- **Alert Generation**:
  - Alerts when nodes are penalized in ≥70% of recent epochs
  - Alerts when penalty list exceeds 20 nodes
- **Update Mechanism**:
  - Updates when validator data changes
  - Automatically adapts window as new epochs arrive

## Miner Monitor Details

The Miner Monitor focuses on block production and consensus rule compliance:

- **Performance Tracking**: Records successful mining operations per address
- **Missed Rounds Detection**: Uses blockchain API to get authoritative data on missed rounds
- **Timeout Detection**: Analyzes timestamp differences to detect timeout events
- **Violation Recording**: Maintains record of consensus violations for analysis
- **Batch Processing**: Processes blocks in configurable batches for efficiency
- **Complete Coverage**: Ensures every block is analyzed, even across monitoring restarts

## Development Status

Current implementation status:

- ✅ Miner Monitor: Fully implemented with multi-chain support
- ✅ Epoch Monitor: Fully implemented with sliding window penalty tracking
- 🚧 Reward Monitor: Skeleton implementation
