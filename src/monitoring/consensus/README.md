# Consensus Monitoring System

## Overview

This directory contains the XDC Consensus Monitoring System, which tracks and validates various aspects of the XDPoS 2.0 consensus mechanism across XDC networks.

## Architecture

The system follows a modular design with a central coordinator and specialized monitoring services:

### Central Coordinator

- **[ConsensusMonitorService](./consensus.monitor.ts)** - Coordinates the monitoring services and provides a unified interface
- **[Consensus Utilities](./consensus.utils.ts)** - Shared utilities for epoch detection, RPC client creation, and configuration

### Specialized Monitors

1. **[Miner Monitor](./miner/README.md)** - Tracks the round-robin mining pattern and timeout detection ✅
2. **[Epoch Monitor](./epoch/README.md)** - Monitors epoch transitions and masternode list updates 🚧
3. **[Reward Monitor](./reward/README.md)** - Validates reward distribution at epoch boundaries 🚧

The specialized services are coordinated by the `ConsensusMonitorService`, which provides a unified interface for the monitoring system.

## Multi-Chain Support

The consensus monitoring system supports monitoring multiple chains simultaneously:

- **Mainnet (Chain ID: 50)** - XDC Production Network
- **Testnet (Chain ID: 51)** - XDC Apothem Network

Configuration options:

- `enableConsensusMonitoring`: Toggle feature on/off
- `consensusScanInterval`: Time between consensus checks (default: 15000ms)
- `consensusMonitoringChains`: Comma-separated list of chain IDs to monitor (default: 50,51)

Each chain maintains its own independent state, including:

- Current epoch information
- Masternode list
- Mining performance metrics
- Consensus violations

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

#### Determining Epoch Boundaries

To check if the blockchain has moved to a new epoch or to determine the block range of an epoch, use the `XDPoS_getEpochNumbersBetween` API:

```bash
curl --location 'https://rpc.xinfin.network' \
--header 'Content-Type: application/json' \
--data '{"jsonrpc":"2.0","method":"XDPoS_getEpochNumbersBetween","params":["0x52FF312", "0x52FF6FA"],"id":1}'
```

This API returns a list of block numbers where each block is the first block of a new epoch:

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "result": [87028748]
}
```

Best practices for epoch detection:

- Use a lookback window of ~1000 blocks (enough to cover an entire epoch)
- Compare the most recent epoch boundary with your previously recorded one
- If you find a newer epoch boundary, refresh the masternode list

Example implementation:

```typescript
// Look back 1000 blocks to ensure we catch any epoch transition
const lookbackBlock = Math.max(1, currentBlock - 1000);
const hexCurrentBlock = `0x${currentBlock.toString(16)}`;
const hexLookbackBlock = `0x${lookbackBlock.toString(16)}`;

// Get all epoch boundaries in the last 1000 blocks
const response = await rpcClient.call('XDPoS_getEpochNumbersBetween', [hexLookbackBlock, hexCurrentBlock]);

if (response?.result?.length > 0) {
  const latestEpochBlock = response.result[response.result.length - 1];

  // If the latest epoch boundary is newer than what we had before,
  // we've entered a new epoch
  const isNewEpoch = latestEpochBlock > previousEpochBlock;

  if (isNewEpoch) {
    // Refresh masternode list
  }
}
```

### Mining Process

- Masternodes mine blocks in a round-robin sequence based on round number
- Example with masternode list [a, b, c, d, e]:
  - Block 901, Round 1000: miner = a
  - Block 902, Round 1001: miner = b
  - Block 903, Round 1002: miner = c

### Timeout Handling

- If a masternode is offline when its turn arrives, a 10-second timeout occurs
- After timeout, the next masternode in sequence takes over
- Example:
  - Block 901, Round 1000: miner = a
  - Block 902, Round 1001: miner = b
  - Block 903, Round 1002: miner = c (offline) → timeout
  - Block 903, Round 1003: miner = d

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

## API

The monitoring system exposes several API endpoints through the `MonitoringController`:

- `/monitoring/consensus-status` - Overall consensus monitoring status across chains
- `/monitoring/consensus-status/:chainId` - Consensus status for a specific chain
- `/monitoring/masternode-performance/:chainId` - Performance metrics for masternodes on a specific chain
- `/monitoring/consensus-violations/:chainId` - Detected consensus rule violations on a specific chain

## Development Status

Current implementation status:

- ✅ Miner Monitor: Fully implemented with multi-chain support
- 🚧 Epoch Monitor: Skeleton implementation
- 🚧 Reward Monitor: Skeleton implementation
