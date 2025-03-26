export enum TransactionStatus {
  PENDING = 'pending',
  CONFIRMED = 'confirmed',
  FAILED = 'failed',
}

export interface TransactionInfo {
  hash: string;
  from: string;
  to?: string;
  value: bigint;
  gas: bigint;
  gasPrice: bigint;
  nonce: number;
  status: TransactionStatus;
  blockNumber?: number;
  input?: string;
  transactionIndex?: number;
}
