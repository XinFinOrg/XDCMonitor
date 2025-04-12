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
6. **Batch Processing**: Processes blocks in configurable batches for efficient resource utilization
7. **Violation Recording**: Maintains a history of consensus violations for analysis and reporting

## Architecture Integration

The MinerMonitor is designed to work within the orchestrated monitoring system:

1. **Orchestrated Initialization**:

   - Rather than self-initializing, MinerMonitor waits for ConsensusMonitor to trigger it
   - This ensures validator data is available before monitoring starts
   - Prevents race conditions where monitoring would begin before data is ready

2. **Data Flow**:

   - ConsensusMonitor loads and manages validator data for all chains
   - MinerMonitor retrieves this data via `consensusMonitor.getValidatorData()`
   - This creates a clean dependency structure where data flows from centralized storage

3. **Lifecycle Management**:
   - ConsensusMonitor registers and manages all monitoring intervals
   - MinerMonitor exposes its monitoring logic but doesn't schedule itself
   - This centralizes scheduling and cleanup for better resource management
   - Monitoring cycles are tracked to detect initial runs and handle them appropriately

## Monitoring Approach

### Blockchain-First Approach

The monitoring system embraces a "blockchain-first" approach:

1. **Authoritative Data Source**: Uses the blockchain's own APIs to determine which rounds were missed
2. **Timeout Verification**: Measures actual timeout periods by comparing block timestamps
3. **No Prediction**: Avoids attempting to predict the expected miner, which becomes inaccurate after any missed round

This approach eliminates false alerts that would occur when using position-based miner prediction, as the blockchain itself provides the definitive record of missed rounds.

### Metrics vs. Alerts Separation

The system maintains a clear separation between metrics collection and alerts:

1. **Dedicated Metrics**:

   - `consensus_missed_rounds`: Records every missed round with detailed information
   - `consensus_timeout_periods`: Tracks timeout periods between blocks for statistical analysis
   - `consensus_miner_timeouts`: Maintains cumulative statistics for each miner's performance
   - `consensus_miner_performance`: Tracks comprehensive mining statistics for each masternode

2. **Threshold-Based Alerts**:
   - Alerts are only generated for actionable events that require attention
   - Unusual timeout periods (deviating more than 2 seconds from expected)
   - Frequent timeouts for specific miners (every 10 occurrences)
   - System errors during monitoring

This approach reduces alert noise while maintaining comprehensive data for analysis.

### Missed Round Processing

For each missed round detected by the blockchain:

1. The system retrieves the actual blocks involved
2. It calculates the precise timeout period from timestamps
3. It records metrics for the missed round and timeout period
4. It generates alerts only when thresholds are exceeded
5. It updates the miner performance statistics to reflect missed rounds

### Real-time Monitoring

For newly produced blocks:

1. The system tracks all new blocks in batch processing
2. It records miner performance metrics for each block
3. It identifies blocks associated with known missed rounds
4. It relies on the blockchain API for authoritative timeout data
5. It periodically checks for missed rounds using blockchain API
6. It updates performance statistics for each active miner

## Configuration Options

The Miner Monitor is configured through environment variables:

- `ENABLE_CONSENSUS_MONITORING`: Enable/disable consensus monitoring (in the "Monitoring features" section)
- `CONSENSUS_MONITORING_CHAIN_IDS`: Comma-separated list of chain IDs to monitor (default: 50,51)
- `CONSENSUS_SCAN_INTERVAL`: Time between consensus checks in milliseconds (default: 15000ms)

Example configuration in `.env`:

```
# Monitoring features
ENABLE_RPC_MONITORING=true
ENABLE_BLOCK_MONITORING=true
ENABLE_PORT_MONITORING=true
ENABLE_CONSENSUS_MONITORING=true

# Consensus monitoring configuration
CONSENSUS_MONITORING_CHAIN_IDS=50,51
CONSENSUS_SCAN_INTERVAL=15000
```

## Integration Points

- **BlockchainService**: Access to blockchain data and RPC methods
- **ConfigService**: Configuration values for monitoring parameters
- **MetricsService**: Records dedicated metrics for missed rounds and timeouts
- **AlertService**: Sends alerts only when actionable thresholds are exceeded
- **ConsensusMonitor**: Provides validator data and manages monitoring intervals

## How It Works

### Initialization Flow

The initialization sequence follows the orchestrated approach:

1. **Module Init**:

   - MinerMonitor is created with dependencies injected
   - Basic structure is initialized but monitoring doesn't start
   - State is prepared to begin monitoring when triggered

2. **Orchestrated Start**:

   - ConsensusMonitor first loads validator data for all chains
   - It then calls `miner.loadHistoricalMinerData()` for each chain
   - Finally, it registers monitoring intervals for MinerMonitor
   - This ensures data is available before monitoring begins

3. **Monitoring Execution**:
   - ConsensusMonitor triggers `monitorMiners()` on the set interval
   - MinerMonitor retrieves validator data from ConsensusMonitor
   - This creates a clean dependency flow for data

### Block Coverage

The Miner Monitor uses an efficient batch processing approach to ensure complete coverage of all blocks:

1. Every monitoring cycle (typically 15 seconds), the service:
   - Determines the latest block number
   - Fetches all blocks produced since the last check in efficient batches (default batch size: 50)
   - Processes each block directly in the monitoring loop
   - Updates performance metrics and identifies known missed rounds
   - Logs performance statistics for transparency

### Missed Round Detection

The system uses the blockchain's `XDPoS_getMissedRoundsInEpochByBlockNum` API to:

- Get authoritative information about which rounds were missed
- Identify which masternodes were expected to mine but didn't
- Track the actual miners who took over after timeouts
- Update this data periodically (every 50 blocks by default)

### Timeout Period Verification

For each missed round, the system:

1. Retrieves the blocks before and after the missed round
2. Calculates the actual timeout period from block timestamps
3. Precisely determines number of miners skipped by comparing positions in the masternode list:
   - Finds the index of the expected miner (who missed their turn)
   - Finds the index of the actual miner (who successfully mined the block)
   - Calculates the exact number of miners skipped based on position difference
   - Handles wraparound cases when the expected miner is near the end of the list
4. Verifies if the timeout period is consistent with the number of miners skipped:
   - Each missed miner should add approximately 10 seconds to the timeout
   - Inconsistencies between actual timeout and expected timeout indicate consensus issues
5. Records the timeout period as a dedicated metric with enhanced context
6. Generates specifically tailored alerts based on the scenario detected:
   - Inconsistent Timeout: When the timeout period doesn't match the expected duration
   - Multiple Consecutive Misses: When 3+ miners in sequence miss their turns

This position-based analysis provides definitive information about missed miners, rather than estimating based on timeout duration alone. It can accurately distinguish between normal timeout behavior (miners simply offline) and potential consensus issues (timeout periods inconsistent with the number of miners missed).

## Metrics Tracking

The monitoring system tracks four primary types of metrics:

1. **Missed Rounds**: Records each missed round event with round number, block number, expected and actual miners
2. **Timeout Periods**: Tracks the time between blocks when a timeout occurs, with variance from expected values
3. **Miner Missed Rounds**: Tracks the cumulative count of missed rounds for each miner
4. **Comprehensive Miner Performance**: Records complete performance metrics including:
   - Total blocks successfully mined
   - Missed blocks count
   - Total mining attempts
   - Success rate (as a percentage)
   - Last active block number
   - Latest mining round

These metrics provide a holistic view of the network's consensus health and individual validator performance. The success rate calculation (successful blocks ÷ total attempts × 100) offers a clear indicator of validator reliability over time.

## API Endpoints

- `/monitoring/masternode-performance/:chainId`: Shows performance metrics for each masternode on a specific chain
- `/monitoring/consensus-violations/:chainId`: Lists detected consensus events with timestamp and details
- `/monitoring/consensus-status`: Overall consensus monitoring status across chains

## Data Structures

- `MinerPerformance`: Tracks mining statistics for each masternode
- `ConsensusViolation`: Records instances of missed rounds and timeouts
- `MissedRound`: Stores information about rounds that were missed according to the blockchain
- `ChainState`: Maintains monitoring state for each supported chain

## Key Features

- **Orchestrated Architecture**: Works within an orchestrated monitoring system
- **Metrics-Alerts Separation**: Clear distinction between data collection and actionable notifications
- **Authoritative Monitoring**: Uses blockchain data as the source of truth
- **Timeout Verification**: Verifies actual timeout periods match expected thresholds
- **Performance Tracking**: Tracks statistics for each masternode (blocks mined, timeouts, etc.)
- **Complete Block Coverage**: Ensures no blocks are missed in the monitoring process
- **Optimized Processing**: Directly processes blocks in the monitoring loop for improved efficiency
- **Recent Violation History**: Maintains a capped list of recent violations for analysis
- **Adaptive Monitoring**: Checks for missed rounds at dynamic intervals based on block production
- **Multi-Chain Support**: Simultaneously monitors both Mainnet and Testnet with chain-specific state
- **Comprehensive API**: Exposes detailed monitoring data through well-structured API endpoints

## Implementation Tasks

1. **Round-Robin Order Verification**:

   - Monitor block production sequence against the masternode list
   - Verify each block is mined by the correct masternode based on round number
   - Log violations when blocks are mined out of sequence

2. **Timeout Monitoring**:
   - Detect 10-second timeouts when a masternode fails to respond
   - Verify the correct next masternode takes over after timeout
   - Track timeout frequency by masternode for performance analysis
