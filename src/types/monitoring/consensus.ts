/**
 * Interface for miner record from InfluxDB
 */
export interface MinerRecord {
  miner?: string;
  total_blocks_mined?: string | number;
  missed_blocks?: string | number;
  last_block?: string | number;
  _time?: string;
  [key: string]: unknown; // Allow for additional properties from InfluxDB
}

/**
 * Interface for XDC masternode list
 */
export interface MasternodeList {
  number: number;
  round: number;
  masternodes: string[];
  penalty: string[];
  standbynodes: string[];
}

/**
 * Interface for consensus violation record
 */
export interface ConsensusViolation {
  blockNumber: number;
  round: number;
  expectedMiner: string;
  actualMiner: string;
  violationType: 'wrong_miner' | 'timeout';
  timestamp: Date;
  timeDifference?: number; // In seconds for timeout violations
  estimatedMissedMiners?: number; // Estimated number of consecutive miners that missed their turn
}

/**
 * Interface for miner performance tracking
 */
export interface MinerPerformance {
  address: string;
  totalBlocksMined: number;
  missedBlocks: number;
  lastActiveBlock?: number;
  lastActive?: Date;
}

/**
 * Interface for consensus monitoring information
 */
export interface ConsensusMonitoringInfo {
  isEnabled: boolean;
  chainId?: number; // Chain ID (50 for mainnet, 51 for testnet)
  lastCheckedBlock: number;
  currentEpoch: number;
  currentEpochBlock?: number; // Block number where the current epoch started
  masternodeCount: number;
  standbyNodeCount: number;
  penaltyNodeCount: number;
  recentViolations: ConsensusViolation[];
  minerPerformance: Record<string, MinerPerformance>;
}

/**
 * Interface for alert data
 */
export interface ConsensusAlert {
  name: string;
  message: string;
  severity: 'info' | 'warning' | 'error' | 'critical';
  metadata: Record<string, any>;
}
