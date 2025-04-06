# Miner Monitor

## Purpose and Responsibilities

The Miner Monitor service tracks the XDPoS 2.0 consensus mechanism across XDC networks, focusing primarily on monitoring missed rounds and timeout events directly from blockchain data rather than attempting to predict the correct miner sequence.

> **Note:** For general information about the XDPoS 2.0 consensus mechanism, including masternode system, epoch structure, and mining process, please refer to the [main consensus documentation](../README.md).

## Core Workflows

1. **Complete Block Coverage**: Monitors all blocks by processing batches of blocks since the last check
2. **Blockchain API Integration**: Relies on the `XDPoS_getMissedRoundsInEpochByBlockNum` API for authoritative missed round data
3. **Timeout Period Verification**: Verifies the actual timeout periods from block timestamps
4. **Miner Performance Tracking**: Records statistics on each masternode's mining activity and reliability
5. **Consensus Monitoring**: Logs blockchain consensus events without attempting to predict miners

## Monitoring Approach

### Blockchain-First Approach

The monitoring system embraces a "blockchain-first" approach:

1. **Authoritative Data Source**: Uses the blockchain's own APIs to determine which rounds were missed
2. **Timeout Verification**: Measures actual timeout periods by comparing block timestamps
3. **No Prediction**: Avoids attempting to predict the expected miner, which becomes inaccurate after any missed round

This approach eliminates false alerts that would occur when using position-based miner prediction, as the blockchain itself provides the definitive record of missed rounds.

### Missed Round Processing

For each missed round detected by the blockchain:

1. The system retrieves the actual blocks involved
2. It calculates the precise timeout period from timestamps
3. It verifies if the timeout matches the expected 10-second threshold
4. Any deviations are reported for further investigation

### Real-time Monitoring

For newly produced blocks:

1. The system tracks all new blocks in batch processing
2. It records miner performance metrics for each block
3. It identifies blocks associated with known missed rounds
4. It relies on the blockchain API for authoritative timeout data

## Configuration Options

- `enableConsensusMonitoring`: Toggle feature on/off via ConfigService
- `consensusScanInterval`: Time between consensus checks (defaults to 15000ms)
- `consensusMonitoringChains`: List of chain IDs to monitor (defaults to [50, 51] for mainnet and testnet)
- Configurable alert thresholds for unusual timeout periods

## Integration Points

- **BlockchainService**: Access to blockchain data and RPC methods
- **ConfigService**: Configuration values for monitoring parameters
- **BlocksMonitorService**: Block data for consensus analysis
- **MetricsService**: Reports miner performance metrics for dashboards
- **AlertService**: Sends alerts on detected consensus anomalies
- **ConsensusMonitorService**: Provides centralized validator data

## How It Works

### Block Coverage

The Miner Monitor uses an efficient batch processing approach to ensure complete coverage of all blocks:

1. Every monitoring cycle (typically 15 seconds), the service:
   - Determines the latest block number
   - Fetches all blocks produced since the last check in efficient batches
   - Processes each block directly in the monitoring loop
   - Updates performance metrics and identifies known missed rounds

### Missed Round Detection

The system uses the blockchain's `XDPoS_getMissedRoundsInEpochByBlockNum` API to:

- Get authoritative information about which rounds were missed
- Identify which masternodes were expected to mine but didn't
- Track the actual miners who took over after timeouts

### Timeout Period Verification

For each missed round, the system:

1. Retrieves the blocks before and after the missed round
2. Calculates the actual timeout period from block timestamps
3. Verifies if the timeout matches the expected 10-second threshold
4. Reports any deviations from the expected timeout period

## API Endpoints

- `/monitoring/masternode-performance`: Shows performance metrics for each masternode
- `/monitoring/consensus-violations`: Lists detected consensus events with timestamp and details

## Data Structures

- `MinerPerformance`: Tracks mining statistics for each masternode
- `ConsensusViolation`: Records instances of missed rounds and timeouts
- `MissedRound`: Stores information about rounds that were missed according to the blockchain

## Monitoring Features

- **Authoritative Consensus Monitoring**: Uses blockchain data as the source of truth
- **Timeout Period Verification**: Verifies the actual timeout periods match the expected threshold
- **Performance Metrics**: Tracks statistics for each masternode (blocks mined, timeouts, etc.)
- **Complete Block Coverage**: Ensures no blocks are missed in the monitoring process
- **Optimized Processing**: Directly processes blocks in the monitoring loop for improved efficiency

## Implementation Tasks

1. **Round-Robin Order Verification**:

   - Monitor block production sequence against the masternode list
   - Verify each block is mined by the correct masternode based on round number
   - Log violations when blocks are mined out of sequence

2. **Timeout Monitoring**:
   - Detect 10-second timeouts when a masternode fails to respond
   - Verify the correct next masternode takes over after timeout
   - Track timeout frequency by masternode for performance analysis
