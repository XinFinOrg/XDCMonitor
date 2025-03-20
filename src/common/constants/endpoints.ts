export const MAINNET_CHAIN_ID = 50;
export const TESTNET_CHAIN_ID = 51;

export const RPC_ENDPOINTS = [
  // Mainnet endpoints
  { url: 'https://rpc.xinfin.network', name: 'XDC Mainnet Primary', type: 'rpc' as const, chainId: MAINNET_CHAIN_ID },
  { url: 'https://erpc.xinfin.network', name: 'XDC Mainnet eRPC', type: 'erpc' as const, chainId: MAINNET_CHAIN_ID },
  { url: 'https://arpc.xinfin.network', name: 'XDC Mainnet Archive', type: 'rpc' as const, chainId: MAINNET_CHAIN_ID },
  {
    url: 'https://earpc.xinfin.network',
    name: 'XDC Mainnet Archive eRPC',
    type: 'erpc' as const,
    chainId: MAINNET_CHAIN_ID,
  },
  { url: 'https://xdc.public-rpc.com', name: 'XDC Public RPC', type: 'rpc' as const, chainId: MAINNET_CHAIN_ID },
  { url: 'https://rpc.primenumbers.xyz', name: 'PrimeNumbers RPC', type: 'rpc' as const, chainId: MAINNET_CHAIN_ID },
  { url: 'https://erpc.xdcrpc.com', name: 'XDCRPC eRPC', type: 'erpc' as const, chainId: MAINNET_CHAIN_ID },
  {
    url: 'http://173.212.233.170:8989',
    name: 'mst1-Custom Mainnet RPC',
    type: 'rpc' as const,
    chainId: MAINNET_CHAIN_ID,
  },

  // Testnet endpoints
  { url: 'https://rpc.apothem.network', name: 'Apothem Testnet RPC', type: 'rpc' as const, chainId: TESTNET_CHAIN_ID },
  { url: 'https://apothem.xdcrpc.com', name: 'Apothem XDCRPC', type: 'rpc' as const, chainId: TESTNET_CHAIN_ID },
  {
    url: 'https://erpc.apothem.network',
    name: 'Apothem Testnet eRPC',
    type: 'erpc' as const,
    chainId: TESTNET_CHAIN_ID,
  },
  {
    url: 'http://157.173.195.189:8555',
    name: 'mst2-Custom Testnet RPC',
    type: 'rpc' as const,
    chainId: TESTNET_CHAIN_ID,
  },
];

export const WS_ENDPOINTS = [
  // Mainnet WebSocket endpoints
  {
    url: 'wss://ws.xinfin.network',
    name: 'XDC Mainnet WebSocket',
    type: 'websocket' as const,
    chainId: MAINNET_CHAIN_ID,
  },
  {
    url: 'wss://rpc.xinfin.network/ws',
    name: 'XDC RPC WebSocket Path',
    type: 'websocket' as const,
    chainId: MAINNET_CHAIN_ID,
  },
  {
    url: 'wss://erpc.xinfin.network/ws',
    name: 'XDC eRPC WebSocket Path',
    type: 'websocket' as const,
    chainId: MAINNET_CHAIN_ID,
  },
  {
    url: 'wss://xdc.public-rpc.com/ws',
    name: 'XDC Public RPC WebSocket',
    type: 'websocket' as const,
    chainId: MAINNET_CHAIN_ID,
  },
  {
    url: 'wss://rpc.xinfin.network',
    name: 'XDC RPC as WebSocket',
    type: 'websocket' as const,
    chainId: MAINNET_CHAIN_ID,
  },
  {
    url: 'wss://erpc.xinfin.network',
    name: 'XDC eRPC as WebSocket',
    type: 'websocket' as const,
    chainId: MAINNET_CHAIN_ID,
  },
  {
    url: 'ws://173.212.233.170:8888',
    name: 'mst1-Custom Mainnet WebSocket',
    type: 'websocket' as const,
    chainId: MAINNET_CHAIN_ID,
  },

  // Additional Mainnet endpoints (enabled conditionally)
  {
    url: 'wss://ews.xinfin.network',
    name: 'XDC Mainnet eWebSocket',
    type: 'websocket' as const,
    chainId: MAINNET_CHAIN_ID,
    conditional: true,
  },
  {
    url: 'wss://aws.xinfin.network',
    name: 'XDC Mainnet Archive WebSocket',
    type: 'websocket' as const,
    chainId: MAINNET_CHAIN_ID,
    conditional: true,
  },
  {
    url: 'wss://eaws.xinfin.network',
    name: 'XDC Mainnet Archive eWebSocket',
    type: 'websocket' as const,
    chainId: MAINNET_CHAIN_ID,
    conditional: true,
  },

  // Testnet WebSocket endpoints
  {
    url: 'wss://ws.apothem.network/ws',
    name: 'Apothem Testnet WebSocket',
    type: 'websocket' as const,
    chainId: TESTNET_CHAIN_ID,
  },
  {
    url: 'ws://157.173.195.189:8556',
    name: 'mst2-Custom Testnet WebSocket',
    type: 'websocket' as const,
    chainId: TESTNET_CHAIN_ID,
  },
];

export const EXPLORER_ENDPOINTS = [
  // Mainnet explorers
  { url: 'https://explorer.xinfin.network', name: 'XDC Explorer', type: 'rpc' as const, chainId: MAINNET_CHAIN_ID },
  { url: 'https://xdcscan.io', name: 'XDCScan', type: 'rpc' as const, chainId: MAINNET_CHAIN_ID },
  { url: 'https://blocksscan.io', name: 'BlocksScan', type: 'rpc' as const, chainId: MAINNET_CHAIN_ID },

  // Testnet explorers
  {
    url: 'https://explorer.apothem.network',
    name: 'Apothem Explorer',
    type: 'rpc' as const,
    chainId: TESTNET_CHAIN_ID,
  },
  { url: 'https://apothem.xdcscan.io', name: 'Apothem XDCScan', type: 'rpc' as const, chainId: TESTNET_CHAIN_ID },
  { url: 'https://apothem.blocksscan.io', name: 'Apothem BlocksScan', type: 'rpc' as const, chainId: TESTNET_CHAIN_ID },
];

export const FAUCET_ENDPOINTS = [
  // Testnet faucets
  { url: 'https://faucet.apothem.network', name: 'Apothem Faucet', type: 'rpc' as const, chainId: TESTNET_CHAIN_ID },
  { url: 'https://faucet.blocksscan.io', name: 'BlocksScan Faucet', type: 'rpc' as const, chainId: TESTNET_CHAIN_ID },
];

export const PRIMARY_RPC_URLS = {
  [MAINNET_CHAIN_ID]: 'https://rpc.xinfin.network',
  [TESTNET_CHAIN_ID]: 'https://rpc.apothem.network',
};
