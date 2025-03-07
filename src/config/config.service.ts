import { Injectable } from '@nestjs/common';
import * as dotenv from 'dotenv';
import * as fs from 'fs';

export interface RpcEndpoint {
  url: string;
  name: string;
  type: 'rpc' | 'erpc' | 'websocket';
  isMainnet: boolean;
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

  get rpcUrl(): string {
    return this.get('RPC_URL') || 'https://rpc.xinfin.network';
  }

  get rpcEndpoints(): RpcEndpoint[] {
    const endpoints: RpcEndpoint[] = [];

    endpoints.push(
      { url: 'https://rpc.xinfin.network', name: 'XDC Mainnet Primary', type: 'rpc', isMainnet: true },
      { url: 'https://erpc.xinfin.network', name: 'XDC Mainnet eRPC', type: 'erpc', isMainnet: true },
      { url: 'https://arpc.xinfin.network', name: 'XDC Mainnet Archive', type: 'rpc', isMainnet: true },
      { url: 'https://earpc.xinfin.network', name: 'XDC Mainnet Archive eRPC', type: 'erpc', isMainnet: true },
      { url: 'https://xdc.public-rpc.com', name: 'XDC Public RPC', type: 'rpc', isMainnet: true },
      { url: 'https://rpc.primenumbers.xyz', name: 'PrimeNumbers RPC', type: 'rpc', isMainnet: true },
    );

    endpoints.push({ url: 'https://erpc.xdcrpc.com', name: 'XDCRPC eRPC', type: 'erpc', isMainnet: true });

    return endpoints;
  }

  get wsEndpoints(): RpcEndpoint[] {
    const endpoints: RpcEndpoint[] = [];

    const addEndpoint = (url: string, name: string, isMainnet: boolean) => {
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
          isMainnet,
        });
      }
    };

    addEndpoint('wss://ws.xinfin.network', 'XDC Mainnet WebSocket', true);

    addEndpoint('wss://rpc.xinfin.network/ws', 'XDC RPC WebSocket Path', true);
    addEndpoint('wss://erpc.xinfin.network/ws', 'XDC eRPC WebSocket Path', true);
    addEndpoint('wss://xdc.public-rpc.com/ws', 'XDC Public RPC WebSocket', true);

    addEndpoint('wss://rpc.xinfin.network', 'XDC RPC as WebSocket', true);
    addEndpoint('wss://erpc.xinfin.network', 'XDC eRPC as WebSocket', true);

    if (this.get('ENABLE_ADDITIONAL_WS_ENDPOINTS') === 'true') {
      addEndpoint('wss://ews.xinfin.network', 'XDC Mainnet eWebSocket', true);
      addEndpoint('wss://aws.xinfin.network', 'XDC Mainnet Archive WebSocket', true);
      addEndpoint('wss://eaws.xinfin.network', 'XDC Mainnet Archive eWebSocket', true);
    }

    const customWsUrl = this.get('WS_URL');
    if (customWsUrl) {
      addEndpoint(customWsUrl, 'Custom WebSocket', true);
    }

    return endpoints;
  }

  get wsUrl(): string | undefined {
    return this.get('WS_URL');
  }

  get chainId(): number {
    return parseInt(this.get('CHAIN_ID') || '50', 10);
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

  get enableMultiRpc(): boolean {
    return this.get('ENABLE_MULTI_RPC') === 'true';
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

  get metricsPort(): number {
    return parseInt(this.get('METRICS_PORT') || '9090', 10);
  }

  get enablePrometheus(): boolean {
    return this.get('ENABLE_PROMETHEUS') === 'true';
  }

  get logLevel(): string {
    return this.get('LOG_LEVEL') || 'info';
  }

  private get(key: string): string | undefined {
    return process.env[key] || this.envConfig[key];
  }
}
