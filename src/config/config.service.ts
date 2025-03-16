import { Injectable } from '@nestjs/common';
import * as dotenv from 'dotenv';
import * as fs from 'fs';

export interface RpcEndpoint {
  url: string;
  name: string;
  type: 'rpc' | 'erpc' | 'websocket';
  chainId: number;
  status?: 'up' | 'down';
  latency?: number;
}

@Injectable()
export class ConfigService {
  private readonly envConfig: { [key: string]: string };

  constructor() {
    const envFile = '.env';
    this.envConfig = dotenv.parse(fs.existsSync(envFile) ? fs.readFileSync(envFile) : '');
  }

  /**
   * Get the primary RPC URL for a specific chain ID
   */
  getPrimaryRpcUrl(chainId: number): string {
    switch (chainId) {
      case 50:
        return 'https://rpc.xinfin.network';
      case 51:
        return 'https://rpc.apothem.network';
      default:
        return 'https://rpc.xinfin.network';
    }
  }

  get rpcEndpoints(): RpcEndpoint[] {
    const endpoints: RpcEndpoint[] = [];

    endpoints.push(
      { url: 'https://rpc.xinfin.network', name: 'XDC Mainnet Primary', type: 'rpc', chainId: 50 },
      { url: 'https://erpc.xinfin.network', name: 'XDC Mainnet eRPC', type: 'erpc', chainId: 50 },
      { url: 'https://arpc.xinfin.network', name: 'XDC Mainnet Archive', type: 'rpc', chainId: 50 },
      { url: 'https://earpc.xinfin.network', name: 'XDC Mainnet Archive eRPC', type: 'erpc', chainId: 50 },
      { url: 'https://xdc.public-rpc.com', name: 'XDC Public RPC', type: 'rpc', chainId: 50 },
      { url: 'https://rpc.primenumbers.xyz', name: 'PrimeNumbers RPC', type: 'rpc', chainId: 50 },
    );

    endpoints.push({ url: 'https://erpc.xdcrpc.com', name: 'XDCRPC eRPC', type: 'erpc', chainId: 50 });

    // Add custom deployed Mainnet RPC
    endpoints.push({
      url: 'http://173.212.233.170:8989',
      name: 'mst1-Custom Mainnet RPC',
      type: 'rpc',
      chainId: 50,
    });

    // Add Apothem Testnet RPC endpoints
    endpoints.push(
      { url: 'https://rpc.apothem.network', name: 'Apothem Testnet RPC', type: 'rpc', chainId: 51 },
      { url: 'https://apothem.xdcrpc.com', name: 'Apothem XDCRPC', type: 'rpc', chainId: 51 },
      { url: 'https://erpc.apothem.network', name: 'Apothem Testnet eRPC', type: 'erpc', chainId: 51 },
    );

    // Add custom deployed Testnet RPC
    endpoints.push({
      url: 'http://157.173.195.189:8555',
      name: 'mst2-Custom Testnet RPC',
      type: 'rpc',
      chainId: 51,
    });

    return endpoints;
  }

  get wsEndpoints(): RpcEndpoint[] {
    const endpoints: RpcEndpoint[] = [];

    const addEndpoint = (url: string, name: string, chainId: number) => {
      // Ensure URL starts with ws:// or wss://
      if (!url.startsWith('ws://') && !url.startsWith('wss://')) {
        // Convert http:// to ws:// and https:// to wss://
        if (url.startsWith('http://')) {
          url = 'ws://' + url.substring(7);
        } else if (url.startsWith('https://')) {
          url = 'wss://' + url.substring(8);
        } else {
          // Default to wss:// for security if no protocol is specified
          url = 'wss://' + url;
        }
      }

      // Only add if not a duplicate URL
      if (!endpoints.some(ep => ep.url === url)) {
        endpoints.push({
          url,
          name,
          type: 'websocket',
          chainId,
        });
      }
    };

    addEndpoint('wss://ws.xinfin.network', 'XDC Mainnet WebSocket', 50);

    addEndpoint('wss://rpc.xinfin.network/ws', 'XDC RPC WebSocket Path', 50);
    addEndpoint('wss://erpc.xinfin.network/ws', 'XDC eRPC WebSocket Path', 50);
    addEndpoint('wss://xdc.public-rpc.com/ws', 'XDC Public RPC WebSocket', 50);

    addEndpoint('wss://rpc.xinfin.network', 'XDC RPC as WebSocket', 50);
    addEndpoint('wss://erpc.xinfin.network', 'XDC eRPC as WebSocket', 50);

    // Add custom deployed Mainnet WebSocket
    addEndpoint('ws://173.212.233.170:8888', 'mst1-Custom Mainnet WebSocket', 50);

    // Add Apothem Testnet WebSocket endpoint
    addEndpoint('wss://ws.apothem.network/ws', 'Apothem Testnet WebSocket', 51);

    // Add custom deployed Testnet WebSocket
    addEndpoint('ws://157.173.195.189:8556', 'mst2-Custom Testnet WebSocket', 51);

    if (this.get('ENABLE_ADDITIONAL_WS_ENDPOINTS') === 'true') {
      addEndpoint('wss://ews.xinfin.network', 'XDC Mainnet eWebSocket', 50);
      addEndpoint('wss://aws.xinfin.network', 'XDC Mainnet Archive WebSocket', 50);
      addEndpoint('wss://eaws.xinfin.network', 'XDC Mainnet Archive eWebSocket', 50);
    }

    return endpoints;
  }

  get blocksToScan(): number {
    return parseInt(this.get('BLOCKS_TO_SCAN') || '10', 10);
  }

  get scanInterval(): number {
    return parseInt(this.get('SCAN_INTERVAL') || '15', 10);
  }

  get enableRpcMonitoring(): boolean {
    return this.get('ENABLE_RPC_MONITORING') === 'true';
  }

  get enablePortMonitoring(): boolean {
    return this.get('ENABLE_PORT_MONITORING') === 'true';
  }

  get enableBlockMonitoring(): boolean {
    return this.get('ENABLE_BLOCK_MONITORING') === 'true';
  }

  get blockTimeThreshold(): number {
    return parseFloat(this.get('BLOCK_TIME_THRESHOLD') || '2.0');
  }

  // Alert configuration
  get enableDashboardAlerts(): boolean {
    return this.get('ENABLE_DASHBOARD_ALERTS') === 'true';
  }

  get enableChatNotifications(): boolean {
    return this.get('ENABLE_CHAT_NOTIFICATIONS') === 'true';
  }

  get notificationWebhookUrl(): string | undefined {
    return this.get('NOTIFICATION_WEBHOOK_URL');
  }

  get telegramBotToken(): string | undefined {
    return this.get('TELEGRAM_BOT_TOKEN');
  }

  get telegramChatId(): string | undefined {
    return this.get('TELEGRAM_CHAT_ID');
  }

  get influxDbUrl(): string {
    return this.get('INFLUXDB_URL') || 'http://localhost:8086';
  }

  get influxDbToken(): string {
    return this.get('INFLUXDB_TOKEN') || '';
  }

  get influxDbOrg(): string {
    return this.get('INFLUXDB_ORG') || 'xdc';
  }

  get influxDbBucket(): string {
    return this.get('INFLUXDB_BUCKET') || 'xdc_metrics';
  }

  get logLevel(): string {
    return this.get('LOG_LEVEL') || 'info';
  }

  get explorerEndpoints(): RpcEndpoint[] {
    const endpoints: RpcEndpoint[] = [];

    // Mainnet explorers
    endpoints.push(
      { url: 'https://explorer.xinfin.network', name: 'XDC Explorer', type: 'rpc', chainId: 50 },
      { url: 'https://xdcscan.io', name: 'XDCScan', type: 'rpc', chainId: 50 },
      { url: 'https://blocksscan.io', name: 'BlocksScan', type: 'rpc', chainId: 50 },
    );

    // Apothem Testnet explorers
    endpoints.push(
      { url: 'https://explorer.apothem.network', name: 'Apothem Explorer', type: 'rpc', chainId: 51 },
      { url: 'https://apothem.xdcscan.io', name: 'Apothem XDCScan', type: 'rpc', chainId: 51 },
      { url: 'https://apothem.blocksscan.io', name: 'Apothem BlocksScan', type: 'rpc', chainId: 51 },
    );

    return endpoints;
  }

  get faucetEndpoints(): RpcEndpoint[] {
    const endpoints: RpcEndpoint[] = [];

    // Apothem Testnet faucets
    endpoints.push(
      { url: 'https://faucet.apothem.network', name: 'Apothem Faucet', type: 'rpc', chainId: 51 },
      { url: 'https://faucet.blocksscan.io', name: 'BlocksScan Faucet', type: 'rpc', chainId: 51 },
    );

    return endpoints;
  }

  private get(key: string): string | undefined {
    return process.env[key] || this.envConfig[key];
  }
}
