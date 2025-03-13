import { Injectable, Logger } from '@nestjs/common';
import { ethers } from 'ethers';
import { ConfigService, RpcEndpoint } from '@config/config.service';
import { BlockInfo } from '@models/block.interface';
import { AccountBalance } from '@models/account.interface';
import { TransactionInfo, TransactionStatus } from '@models/transaction.interface';

interface ProviderWithMetadata {
  provider: ethers.JsonRpcProvider;
  endpoint: RpcEndpoint;
}

interface WsProviderWithMetadata {
  provider: ethers.WebSocketProvider;
  endpoint: RpcEndpoint;
}

@Injectable()
export class BlockchainService {
  private readonly logger = new Logger(BlockchainService.name);
  private primaryProvider: ethers.JsonRpcProvider;
  private providers: Map<string, ProviderWithMetadata> = new Map();
  private wsProviders: Map<string, WsProviderWithMetadata> = new Map();
  private activeProvider: ProviderWithMetadata;

  constructor(private readonly configService: ConfigService) {
    // Initialize the primary provider
    this.primaryProvider = new ethers.JsonRpcProvider(this.configService.rpcUrl);

    // Initialize all RPC providers if multi-RPC is enabled
    if (this.configService.enableMultiRpc) {
      this.initializeProviders();
    } else {
      this.logger.log('Multi-RPC monitoring is disabled. Using primary RPC endpoint only.');

      // Add only the primary provider to the map
      this.providers.set(this.configService.rpcUrl, {
        provider: this.primaryProvider,
        endpoint: {
          url: this.configService.rpcUrl,
          name: 'Primary RPC',
          type: 'rpc',
          chainId: 50,
          status: 'up',
        },
      });

      // Initialize WebSocket provider if configured
      if (this.configService.wsUrl) {
        try {
          const wsProvider = new ethers.WebSocketProvider(this.configService.wsUrl);
          this.wsProviders.set(this.configService.wsUrl, {
            provider: wsProvider,
            endpoint: {
              url: this.configService.wsUrl,
              name: 'Primary WebSocket',
              type: 'websocket',
              chainId: 50,
              status: 'up',
            },
          });
          this.logger.log(`WebSocket provider initialized: ${this.configService.wsUrl}`);
        } catch (error) {
          this.logger.error(`Failed to initialize WebSocket provider: ${error.message}`);
        }
      }
    }

    // Set the active provider to the primary one initially
    this.activeProvider = {
      provider: this.primaryProvider,
      endpoint: {
        url: this.configService.rpcUrl,
        name: 'Primary RPC',
        type: 'rpc',
        chainId: 50,
        status: 'up',
      },
    };
  }

  private async initializeProviders(): Promise<void> {
    this.logger.log('Initializing blockchain providers...');

    const endpoints = this.configService.rpcEndpoints;
    this.logger.log(`Found ${endpoints.length} RPC endpoints`);

    const wsEndpoints = this.configService.wsEndpoints;
    this.logger.log(`Found ${wsEndpoints.length} WebSocket endpoints: ${JSON.stringify(wsEndpoints.map(e => e.url))}`);

    endpoints.forEach(endpoint => {
      try {
        if (!endpoint.url || !endpoint.url.startsWith('http')) {
          this.logger.warn(`Invalid RPC URL: ${endpoint.url}`);
          this.providers.set(endpoint.url, {
            provider: null,
            endpoint: { ...endpoint, status: 'down' },
          });
          return;
        }

        const provider = new ethers.JsonRpcProvider(endpoint.url);
        this.providers.set(endpoint.url, { provider, endpoint: { ...endpoint, status: 'up' } });
        this.logger.log(`Initialized RPC provider: ${endpoint.name} (${endpoint.url})`);
      } catch (error) {
        this.logger.error(`Failed to initialize provider ${endpoint.name}: ${error.message}`);
        this.providers.set(endpoint.url, {
          provider: null,
          endpoint: { ...endpoint, status: 'down' },
        });
      }
    });

    wsEndpoints.forEach(endpoint => {
      this.initializeWebSocketProvider(endpoint);
    });
  }

  private initializeWebSocketProvider(endpoint: RpcEndpoint): void {
    try {
      if (!endpoint.url.startsWith('ws://') && !endpoint.url.startsWith('wss://')) {
        this.logger.warn(`Invalid WebSocket URL: ${endpoint.url} - Must start with ws:// or wss://`);
        this.wsProviders.set(endpoint.url, {
          provider: null,
          endpoint: { ...endpoint, status: 'down' },
        });
        return;
      }

      this.logger.log(`Initializing WebSocket provider for ${endpoint.name} (${endpoint.url})`);

      const WebSocket = require('ws');

      const testWs = new WebSocket(endpoint.url, {
        headers: {
          'Pragma': 'no-cache',
          'Cache-Control': 'no-cache',
          'Upgrade': 'websocket',
          'Connection': 'Upgrade',
        },
      });

      const timeout = setTimeout(() => {
        this.logger.warn(`WebSocket connection timeout for ${endpoint.url}`);
        if (testWs.readyState !== WebSocket.CLOSED) {
          testWs.close();
        }
        this.wsProviders.set(endpoint.url, {
          provider: null,
          endpoint: { ...endpoint, status: 'down' },
        });
      }, 5000);

      testWs.on('open', () => {
        clearTimeout(timeout);
        this.logger.log(`WebSocket connection validated for ${endpoint.url}`);

        try {
          const provider = new ethers.WebSocketProvider(endpoint.url);

          const websocket = (provider as any).websocket || (provider as any)._websocket;
          if (websocket) {
            websocket.on('error', (error: any) => {
              this.logger.error(`WebSocket error for ${endpoint.name}: ${error.message}`);
              const providerData = this.wsProviders.get(endpoint.url);
              if (providerData) {
                providerData.endpoint.status = 'down';
              }
            });

            websocket.on('close', () => {
              this.logger.warn(`WebSocket connection closed for ${endpoint.name}`);
              const providerData = this.wsProviders.get(endpoint.url);
              if (providerData) {
                providerData.endpoint.status = 'down';
              }
            });
          }

          this.wsProviders.set(endpoint.url, { provider, endpoint: { ...endpoint, status: 'up' } });
          this.logger.log(`Successfully initialized WebSocket provider: ${endpoint.name}`);
        } catch (error) {
          this.logger.error(`Failed to initialize WebSocket provider ${endpoint.name}: ${error.message}`);
          this.wsProviders.set(endpoint.url, {
            provider: null,
            endpoint: { ...endpoint, status: 'down' },
          });
        }

        testWs.close();
      });

      testWs.on('error', error => {
        clearTimeout(timeout);
        this.logger.error(`WebSocket connection error for ${endpoint.url}: ${error.message}`);
        this.wsProviders.set(endpoint.url, {
          provider: null,
          endpoint: { ...endpoint, status: 'down' },
        });
      });
    } catch (error) {
      this.logger.error(`Error setting up WebSocket connection for ${endpoint.name}: ${error.message}`);
      this.wsProviders.set(endpoint.url, {
        provider: null,
        endpoint: { ...endpoint, status: 'down' },
      });
    }
  }

  getProviderByUrl(url: string): ethers.JsonRpcProvider | null {
    const providerData = this.providers.get(url);
    return providerData ? providerData.provider : null;
  }

  getWsProviderByUrl(url: string): ethers.WebSocketProvider | null {
    const providerData = this.wsProviders.get(url);
    return providerData ? providerData.provider : null;
  }

  getAllProviders(): ProviderWithMetadata[] {
    return Array.from(this.providers.values());
  }

  getAllWsProviders(): WsProviderWithMetadata[] {
    return Array.from(this.wsProviders.values());
  }

  setActiveProvider(url: string): boolean {
    const providerData = this.providers.get(url);
    if (providerData && providerData.provider) {
      this.activeProvider = providerData;
      this.logger.log(`Switched active provider to ${providerData.endpoint.name} (${url})`);
      return true;
    }
    return false;
  }

  getActiveProvider(): ProviderWithMetadata {
    return this.activeProvider;
  }

  async fallbackToNextAvailableProvider(): Promise<boolean> {
    const providers = this.getAllProviders();

    for (const providerData of providers) {
      if (
        providerData.endpoint.url !== this.activeProvider.endpoint.url &&
        providerData.provider &&
        providerData.endpoint.status === 'up'
      ) {
        try {
          await providerData.provider.getBlockNumber();
          this.activeProvider = providerData;
          this.logger.log(`Fallback to provider: ${providerData.endpoint.name} (${providerData.endpoint.url})`);
          return true;
        } catch (error) {
          this.logger.warn(`Provider ${providerData.endpoint.name} is not responding, trying next...`);
          providerData.endpoint.status = 'down';
        }
      }
    }

    return false;
  }

  async getLatestBlock(): Promise<BlockInfo> {
    const blockNumber = await this.activeProvider.provider.getBlockNumber();
    return this.getBlockByNumber(blockNumber);
  }

  async getLatestBlockNumber(url?: string): Promise<number> {
    try {
      let provider: ethers.JsonRpcProvider;

      if (url) {
        // If a specific URL is provided, use that provider
        provider = this.getProviderByUrl(url);
        if (!provider) {
          throw new Error(`No provider found for URL: ${url}`);
        }
      } else {
        // Otherwise use the active provider
        provider = this.activeProvider.provider;
      }

      const blockNumber = await provider.getBlockNumber();
      return blockNumber;
    } catch (error) {
      this.logger.error(`Error getting latest block number: ${error.message}`);
      throw error;
    }
  }

  async getBlockByNumber(blockNumber: number): Promise<BlockInfo> {
    try {
      const block = await this.activeProvider.provider.getBlock(blockNumber, true);

      if (!block) {
        throw new Error(`Block #${blockNumber} not found`);
      }

      return {
        number: block.number,
        hash: block.hash,
        timestamp: block.timestamp,
        transactions: block.transactions.map(tx => (typeof tx === 'string' ? tx : (tx as { hash: string }).hash)),
        gasUsed: block.gasUsed,
        gasLimit: block.gasLimit,
        parentHash: block.parentHash,
        miner: block.miner,
      };
    } catch (error) {
      this.logger.error(`Error getting block #${blockNumber}: ${error.message}`);

      if (await this.fallbackToNextAvailableProvider()) {
        return this.getBlockByNumber(blockNumber);
      }

      throw error;
    }
  }

  async getBalance(address: string): Promise<AccountBalance> {
    try {
      const balance = await this.activeProvider.provider.getBalance(address);
      const blockNumber = await this.activeProvider.provider.getBlockNumber();

      return {
        address,
        balance,
        blockNumber,
      };
    } catch (error) {
      this.logger.error(`Error getting balance for ${address}: ${error.message}`);

      if (await this.fallbackToNextAvailableProvider()) {
        return this.getBalance(address);
      }

      throw error;
    }
  }

  async getTransaction(hash: string): Promise<TransactionInfo> {
    try {
      const tx = await this.activeProvider.provider.getTransaction(hash);

      if (!tx) {
        throw new Error(`Transaction ${hash} not found`);
      }

      const receipt = await this.activeProvider.provider.getTransactionReceipt(hash);

      let status: TransactionStatus;
      if (!receipt) {
        status = TransactionStatus.PENDING;
      } else if (receipt.status === 1) {
        status = TransactionStatus.CONFIRMED;
      } else {
        status = TransactionStatus.FAILED;
      }

      return {
        hash: tx.hash,
        from: tx.from,
        to: tx.to,
        value: tx.value,
        gas: tx.gasLimit,
        gasPrice: tx.gasPrice,
        nonce: tx.nonce,
        status,
        blockNumber: tx.blockNumber,
        input: tx.data,
        transactionIndex: tx.index,
      };
    } catch (error) {
      this.logger.error(`Error getting transaction ${hash}: ${error.message}`);

      if (await this.fallbackToNextAvailableProvider()) {
        return this.getTransaction(hash);
      }

      throw error;
    }
  }

  async getTransactionCount(address: string): Promise<number> {
    try {
      return await this.activeProvider.provider.getTransactionCount(address);
    } catch (error) {
      this.logger.error(`Error getting transaction count for ${address}: ${error.message}`);

      if (await this.fallbackToNextAvailableProvider()) {
        return this.getTransactionCount(address);
      }

      throw error;
    }
  }

  async getCode(address: string): Promise<string> {
    try {
      return await this.activeProvider.provider.getCode(address);
    } catch (error) {
      this.logger.error(`Error getting code for ${address}: ${error.message}`);

      if (await this.fallbackToNextAvailableProvider()) {
        return this.getCode(address);
      }

      throw error;
    }
  }

  async getGasPrice(): Promise<ethers.BigNumberish> {
    try {
      return await this.activeProvider.provider.getFeeData().then(data => data.gasPrice);
    } catch (error) {
      this.logger.error(`Error getting gas price: ${error.message}`);

      if (await this.fallbackToNextAvailableProvider()) {
        return this.getGasPrice();
      }

      throw error;
    }
  }

  async checkRpcConnection(url?: string): Promise<boolean> {
    const provider = url ? this.getProviderByUrl(url) : this.activeProvider.provider;

    if (!provider) {
      return false;
    }

    try {
      await provider.getBlockNumber();
      return true;
    } catch (error) {
      this.logger.error(`RPC connection error (${url || this.activeProvider.endpoint.url}): ${error.message}`);
      return false;
    }
  }

  async checkRpcLatency(url?: string): Promise<number> {
    const provider = url ? this.getProviderByUrl(url) : this.activeProvider.provider;

    if (!provider) {
      throw new Error('Provider not available');
    }

    const start = Date.now();
    try {
      await provider.getBlockNumber();
      return Date.now() - start;
    } catch (error) {
      this.logger.error(`RPC latency check error (${url || this.activeProvider.endpoint.url}): ${error.message}`);
      throw error;
    }
  }

  getWsProvider(): ethers.WebSocketProvider | null {
    for (const [, wsProviderData] of this.wsProviders) {
      if (wsProviderData.provider) {
        return wsProviderData.provider;
      }
    }
    return null;
  }
}
