# Miner Monitor

## Purpose and Responsibilities

The Miner Monitor service tracks the round-robin mining pattern in the XDPoS 2.0 consensus mechanism across XDC networks. It verifies that blocks are mined by the correct masternode in sequence and detects timeouts when masternodes fail to respond.

> **Note:** For general information about the XDPoS 2.0 consensus mechanism, including masternode system, epoch structure, and mining process, please refer to the [main consensus documentation](../README.md).

## Core Workflows

1. **Round-Robin Validation**: Ensures blocks are mined by the expected masternode based on the round number
2. **Timeout Detection**: Identifies instances when a masternode fails to mine within the 10-second timeout period
3. **Miner Performance Tracking**: Records statistics on each masternode's mining activity and reliability
4. **Consensus Violation Detection**: Logs and alerts on unexpected deviations from the consensus rules

## Configuration Options

- `enableConsensusMonitoring`: Toggle feature on/off via ConfigService
- `consensusScanInterval`: Time between consensus checks (defaults to 15000ms)
- `consensusMonitoringChains`: List of chain IDs to monitor (defaults to [50, 51] for mainnet and testnet)
- Configurable alert thresholds for repeated timeout violations

## Integration Points

- **BlockchainService**: Access to blockchain data and RPC methods
- **ConfigService**: Configuration values for monitoring parameters
- **BlocksMonitorService**: Block data for consensus analysis
- **MetricsService**: Reports miner performance metrics for dashboards
- **AlertService**: Sends alerts on detected consensus violations

## API Endpoints

- `/monitoring/masternode-performance`: Shows performance metrics for each masternode
- `/monitoring/consensus-violations`: Lists detected mining violations with timestamp and details

## Data Structures

- `MinerPerformance`: Tracks mining statistics for each masternode
- `ConsensusViolation`: Records instances of consensus rule violations
- `ConsensusAlert`: Defines alert structure for mining violations

## Monitoring Features

- **Mining Order Verification**: Validates that blocks are mined in the correct round-robin sequence
- **Timeout Monitoring**: Detects when a masternode doesn't respond within the 10-second timeout
- **Performance Metrics**: Tracks various statistics for each masternode:
  - Total blocks mined
  - Timeouts experienced
  - Missed blocks
  - Last active time
- **Pattern Recognition**: Identifies masternodes with recurring availability issues

## Implementation Tasks

1. **Round-Robin Order Verification**:

   - Monitor block production sequence against the masternode list
   - Verify each block is mined by the correct masternode based on round number
   - Log violations when blocks are mined out of sequence

2. **Timeout Monitoring**:
   - Detect 10-second timeouts when a masternode fails to respond
   - Verify the correct next masternode takes over after timeout
   - Track timeout frequency by masternode for performance analysis
