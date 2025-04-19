/**
 * Interface for endpoint peer count baseline data
 */
export interface PeerCountBaseline {
  // Endpoint URL this baseline data is for
  endpointUrl: string;
  // Type of endpoint (rpc/websocket)
  endpointType: 'rpc' | 'websocket';
  // Chain ID (50 for mainnet, 51 for testnet)
  chainId: number;
  // The baseline/normal peer count for this endpoint
  baselinePeerCount: number;
  // The previous peer count reading
  previousPeerCount: number;
  // The highest peer count observed for this endpoint
  highestPeerCount: number;
  // Number of samples used to calculate the baseline
  sampleCount: number;
  // Timestamps of recent alerts to implement exponential backoff
  recentAlerts: number[];
  // When this baseline was last updated
  lastUpdated: number;
  // Whether this endpoint typically has peers or not
  typicallyHasPeers: boolean;
  // Number of consecutive zeros seen (to avoid noise)
  consecutiveZeros: number;
}
