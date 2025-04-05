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
}

/**
 * Interface for miner performance tracking
 */
export interface MinerPerformance {
  address: string;
  totalBlocksMined: number;
  missedBlocks: number;
  timeoutCount: number;
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
  nextEpochBlock: number;
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
