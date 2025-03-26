/**
 * Status tracking interfaces for RPC and service monitoring
 */

/**
 * Status tracking for RPC endpoints
 */
export interface RpcStatus {
  status: 'up' | 'down' | 'unknown';
  latency: number;
  downSince?: number; // Timestamp when the endpoint went down
  alerted?: boolean; // Whether a notification has been sent for this downtime period
}

/**
 * Status tracking for WebSocket endpoints
 */
export interface WsStatus {
  status: 'up' | 'down' | 'unknown';
  downSince?: number;
  alerted?: boolean;
}

/**
 * Status tracking for services like Explorer and Faucet
 */
export interface ServiceStatus {
  status: 'up' | 'down' | 'unknown';
  downSince?: number;
  alerted?: boolean;
}
