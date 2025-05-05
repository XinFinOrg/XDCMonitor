import { ChainConfig } from '@types';

export const CHAINS: ChainConfig[] = [
  {
    enabled: true, // Toggle to enable/disable this chain for security scans
    chainId: 51,
    name: 'Testnet',
    endpoints: [
      'https://rpc.apothem.network',
      'https://erpc.apothem.network',
      'https://apothem.xdcrpc.com',
      'https://apothem-rpc.xinfin.network',
    ],
  },
  {
    enabled: false, // Set to true to enable Mainnet security scanning
    chainId: 50,
    name: 'Mainnet',
    endpoints: [
      'https://rpc.xinfin.network',
      'https://erpc.xinfin.network',
      'https://xdcrpc.com',
      'https://xinfin.network',
    ],
  },
  // Add more chains as needed
];
