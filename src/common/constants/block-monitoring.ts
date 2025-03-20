import { MAINNET_CHAIN_ID, TESTNET_CHAIN_ID } from './endpoints';

// Network identifiers
export const NETWORK_MAINNET = 'mainnet';
export const NETWORK_TESTNET = 'testnet';

// Chain ID to network mapping
export const CHAIN_ID_TO_NETWORK = {
  [MAINNET_CHAIN_ID]: NETWORK_MAINNET,
  [TESTNET_CHAIN_ID]: NETWORK_TESTNET,
};

// Chain ID to name mapping
export const CHAIN_ID_TO_NAME = {
  [MAINNET_CHAIN_ID]: 'Mainnet',
  [TESTNET_CHAIN_ID]: 'Testnet',
};

// Block monitoring settings
export const RECENT_BLOCKS_SAMPLE_SIZE = 100;
export const SLOW_RPC_THRESHOLD_MS = 1000;
export const BLOCK_DISCREPANCY_SYNC_THRESHOLD = 3;
export const TRANSACTION_HISTORY_WINDOW_MS = 5 * 60 * 1000; // 5 minutes
