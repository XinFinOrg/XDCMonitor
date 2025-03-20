/**
 * Common interfaces for blockchain data structures
 */

// Basic block interface
export interface Block {
  number: string; // Hex-encoded block number
  hash: string;
  parentHash: string;
  timestamp: string; // Hex-encoded timestamp
  nonce: string;
  difficulty: string;
  gasLimit: string;
  gasUsed: string;
  miner: string;
  extraData: string;
  transactions: string[] | Transaction[]; // Array of transaction hashes or full tx objects
  size: string;
  totalDifficulty: string;
  uncles: string[];
  baseFeePerGas?: string; // Only present after EIP-1559
  receiptsRoot: string;
  sha3Uncles: string;
  stateRoot: string;
  transactionsRoot: string;
}

// Typed block with processed fields
export interface TypedBlock {
  number: number;
  hash: string;
  parentHash: string;
  timestamp: number;
  nonce: string;
  difficulty: bigint;
  gasLimit: bigint;
  gasUsed: bigint;
  miner: string;
  extraData: string;
  transactions: string[] | TypedTransaction[];
  size: number;
  totalDifficulty: bigint;
  uncles: string[];
  baseFeePerGas?: bigint;
  receiptsRoot: string;
  sha3Uncles: string;
  stateRoot: string;
  transactionsRoot: string;
}

// Basic transaction interface
export interface Transaction {
  blockHash: string | null;
  blockNumber: string | null; // Hex-encoded block number, null if pending
  from: string;
  gas: string;
  gasPrice: string;
  hash: string;
  input: string;
  nonce: string;
  to: string | null; // null for contract creation
  transactionIndex: string | null; // null if pending
  value: string;
  v: string;
  r: string;
  s: string;
  type?: string; // Transaction type (EIP-2718)
  chainId?: string; // Chain ID (EIP-155)
  maxFeePerGas?: string; // EIP-1559
  maxPriorityFeePerGas?: string; // EIP-1559
  accessList?: AccessListItem[]; // EIP-2930
}

// Typed transaction with processed fields
export interface TypedTransaction {
  blockHash: string | null;
  blockNumber: number | null;
  from: string;
  gas: bigint;
  gasPrice: bigint;
  hash: string;
  input: string;
  nonce: number;
  to: string | null;
  transactionIndex: number | null;
  value: bigint;
  v: string;
  r: string;
  s: string;
  type?: number;
  chainId?: number;
  maxFeePerGas?: bigint;
  maxPriorityFeePerGas?: bigint;
  accessList?: AccessListItem[];
}

// Access list for EIP-2930 transactions
export interface AccessListItem {
  address: string;
  storageKeys: string[];
}

// Transaction receipt
export interface TransactionReceipt {
  transactionHash: string;
  transactionIndex: string;
  blockHash: string;
  blockNumber: string;
  from: string;
  to: string | null;
  cumulativeGasUsed: string;
  gasUsed: string;
  contractAddress: string | null;
  logs: Log[];
  logsBloom: string;
  status: string; // '0x0' for failure, '0x1' for success
  effectiveGasPrice?: string;
  type?: string;
}

// Typed transaction receipt with processed fields
export interface TypedTransactionReceipt {
  transactionHash: string;
  transactionIndex: number;
  blockHash: string;
  blockNumber: number;
  from: string;
  to: string | null;
  cumulativeGasUsed: bigint;
  gasUsed: bigint;
  contractAddress: string | null;
  logs: TypedLog[];
  logsBloom: string;
  status: boolean;
  effectiveGasPrice?: bigint;
  type?: number;
}

// Log interface
export interface Log {
  removed: boolean;
  logIndex: string;
  transactionIndex: string;
  transactionHash: string;
  blockHash: string;
  blockNumber: string;
  address: string;
  data: string;
  topics: string[];
}

// Typed log with processed fields
export interface TypedLog {
  removed: boolean;
  logIndex: number;
  transactionIndex: number;
  transactionHash: string;
  blockHash: string;
  blockNumber: number;
  address: string;
  data: string;
  topics: string[];
}

// Block header info (lighter than full block)
export interface BlockHeader {
  number: string;
  hash: string;
  parentHash: string;
  timestamp: string;
  miner: string;
}

// Typed block header with processed fields
export interface TypedBlockHeader {
  number: number;
  hash: string;
  parentHash: string;
  timestamp: number;
  miner: string;
}

// Block range request
export interface BlockRangeRequest {
  fromBlock: number;
  toBlock: number;
  network?: string;
}

// Block stats
export interface BlockStats {
  blockNumber: number;
  timestamp: number;
  transactionCount: number;
  gasUsed: bigint;
  gasLimit: bigint;
  baseFeePerGas?: bigint;
  blockTime?: number; // Time since last block
  blockSize: number;
  uncleCount: number;
}

// Network information
export interface NetworkInfo {
  chainId: number;
  networkName: string;
  isMainnet: boolean;
  latestBlock: number;
  averageBlockTime: number; // in seconds
}

// RPC node information
export interface RpcNodeInfo {
  url: string;
  isActive: boolean;
  latestBlock?: number;
  responseTime?: number; // in ms
  successRate?: number; // 0 to 1
}

// Utilities to convert between raw and typed forms
export const blockConverters = {
  toTyped(block: Block): TypedBlock {
    return {
      number: parseInt(block.number, 16),
      hash: block.hash,
      parentHash: block.parentHash,
      timestamp: parseInt(block.timestamp, 16),
      nonce: block.nonce,
      difficulty: BigInt(block.difficulty),
      gasLimit: BigInt(block.gasLimit),
      gasUsed: BigInt(block.gasUsed),
      miner: block.miner,
      extraData: block.extraData,
      transactions:
        Array.isArray(block.transactions) && block.transactions.length > 0 && typeof block.transactions[0] === 'object'
          ? (block.transactions as Transaction[]).map(tx => transactionConverters.toTyped(tx))
          : (block.transactions as string[]),
      size: parseInt(block.size, 16),
      totalDifficulty: BigInt(block.totalDifficulty),
      uncles: block.uncles,
      baseFeePerGas: block.baseFeePerGas ? BigInt(block.baseFeePerGas) : undefined,
      receiptsRoot: block.receiptsRoot,
      sha3Uncles: block.sha3Uncles,
      stateRoot: block.stateRoot,
      transactionsRoot: block.transactionsRoot,
    };
  },
};

export const transactionConverters = {
  toTyped(tx: Transaction): TypedTransaction {
    return {
      blockHash: tx.blockHash,
      blockNumber: tx.blockNumber ? parseInt(tx.blockNumber, 16) : null,
      from: tx.from,
      gas: BigInt(tx.gas),
      gasPrice: BigInt(tx.gasPrice),
      hash: tx.hash,
      input: tx.input,
      nonce: parseInt(tx.nonce, 16),
      to: tx.to,
      transactionIndex: tx.transactionIndex ? parseInt(tx.transactionIndex, 16) : null,
      value: BigInt(tx.value),
      v: tx.v,
      r: tx.r,
      s: tx.s,
      type: tx.type ? parseInt(tx.type, 16) : undefined,
      chainId: tx.chainId ? parseInt(tx.chainId, 16) : undefined,
      maxFeePerGas: tx.maxFeePerGas ? BigInt(tx.maxFeePerGas) : undefined,
      maxPriorityFeePerGas: tx.maxPriorityFeePerGas ? BigInt(tx.maxPriorityFeePerGas) : undefined,
      accessList: tx.accessList,
    };
  },
};
