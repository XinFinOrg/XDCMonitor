import { ethers } from 'ethers';
import { RpcEndpoint } from './endpoint';

export interface ProviderWithMetadata {
  provider: ethers.JsonRpcProvider;
  endpoint: RpcEndpoint;
}

export interface WsProviderWithMetadata {
  provider: ethers.WebSocketProvider;
  endpoint: RpcEndpoint;
}
