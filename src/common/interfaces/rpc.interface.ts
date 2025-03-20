/**
 * RPC endpoint configuration
 */
export interface RpcEndpoint {
  url: string;
  name: string;
  type: 'rpc' | 'erpc' | 'websocket';
  chainId: number;
  status?: 'up' | 'down' | 'active';
  latency?: number;
  conditional?: boolean;
}
