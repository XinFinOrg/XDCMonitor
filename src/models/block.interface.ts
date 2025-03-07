export interface BlockInfo {
  number: number;
  hash: string;
  timestamp: number;
  transactions: string[];
  gasUsed: bigint;
  gasLimit: bigint;
  parentHash?: string;
  miner?: string;
  propagationTime?: number;
}
