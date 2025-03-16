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
  private providers: Map<string, ProviderWithMetadata> = new Map();
  private wsProviders: Map<string, WsProviderWithMetadata> = new Map();
  private activeProvider: ProviderWithMetadata;
  private readonly MAX_FAILURES = 3;

  constructor(private readonly configService: ConfigService) {
    // Initialize all providers (always use multi-RPC functionality)
    this.logger.log('Initializing all RPC and WebSocket providers...');
    this.initializeProviders();

    // Set the active provider to the Mainnet primary one initially
    const mainnetPrimaryUrl = this.configService.getPrimaryRpcUrl(50);
    const providerData = this.providers.get(mainnetPrimaryUrl);

    if (providerData) {
      this.activeProvider = providerData;
      this.logger.log(`Set active provider to ${providerData.endpoint.name} (${mainnetPrimaryUrl})`);
    } else {
      // Fallback to first available provider if primary not found
      const firstProvider = Array.from(this.providers.values())[0];
      this.activeProvider = firstProvider;
      this.logger.log(
        `Fallback: Set active provider to ${firstProvider.endpoint.name} (${firstProvider.endpoint.url})`,
      );
    }
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

    this.logger.warn(`No more available providers to try.`);
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
    const chainId = this.activeProvider.endpoint.chainId;
    return this.getBlockByNumberForChain(blockNumber, chainId);
  }

  async getBalance(address: string, failedCount: number = 0): Promise<AccountBalance> {
    if (failedCount >= this.MAX_FAILURES) {
      this.logger.warn(`Maximum failure count (${this.MAX_FAILURES}) reached for getBalance. Stopping attempts.`);
      throw new Error(`Failed to get balance for ${address} after ${failedCount} attempts`);
    }

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

      if (this.isConnectionError(error) && (await this.fallbackToNextAvailableProvider())) {
        return this.getBalance(address, failedCount + 1);
      }

      throw error;
    }
  }

  async getTransaction(hash: string, failedCount: number = 0): Promise<TransactionInfo> {
    if (failedCount >= this.MAX_FAILURES) {
      this.logger.warn(`Maximum failure count (${this.MAX_FAILURES}) reached for getTransaction. Stopping attempts.`);
      throw new Error(`Failed to get transaction ${hash} after ${failedCount} attempts`);
    }

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

      if (!error.message.includes('not found') && (await this.fallbackToNextAvailableProvider())) {
        return this.getTransaction(hash, failedCount + 1);
      }

      throw error;
    }
  }

  async getTransactionCount(address: string, failedCount: number = 0): Promise<number> {
    if (failedCount >= this.MAX_FAILURES) {
      this.logger.warn(
        `Maximum failure count (${this.MAX_FAILURES}) reached for getTransactionCount. Stopping attempts.`,
      );
      throw new Error(`Failed to get transaction count for ${address} after ${failedCount} attempts`);
    }

    try {
      return await this.activeProvider.provider.getTransactionCount(address);
    } catch (error) {
      this.logger.error(`Error getting transaction count for ${address}: ${error.message}`);

      if (this.isConnectionError(error) && (await this.fallbackToNextAvailableProvider())) {
        return this.getTransactionCount(address, failedCount + 1);
      }

      throw error;
    }
  }

  private isConnectionError(error: any): boolean {
    return (
      error &&
      (error.code === 'ETIMEDOUT' ||
        error.code === 'ECONNREFUSED' ||
        error.code === 'ECONNRESET' ||
        error.code === 'ENOTFOUND' ||
        error.code === 'ENETUNREACH' ||
        error.message?.includes('timeout') ||
        error.message?.includes('connection') ||
        error.message?.includes('network') ||
        error.message?.includes('disconnected'))
    );
  }

  async getCode(address: string, failedCount: number = 0): Promise<string> {
    if (failedCount >= this.MAX_FAILURES) {
      this.logger.warn(`Maximum failure count (${this.MAX_FAILURES}) reached for getCode. Stopping attempts.`);
      throw new Error(`Failed to get code for ${address} after ${failedCount} attempts`);
    }

    try {
      return await this.activeProvider.provider.getCode(address);
    } catch (error) {
      this.logger.error(`Error getting code for ${address}: ${error.message}`);

      if (this.isConnectionError(error) && (await this.fallbackToNextAvailableProvider())) {
        return this.getCode(address, failedCount + 1);
      }

      throw error;
    }
  }

  async getGasPrice(failedCount: number = 0): Promise<ethers.BigNumberish> {
    if (failedCount >= this.MAX_FAILURES) {
      this.logger.warn(`Maximum failure count (${this.MAX_FAILURES}) reached for getGasPrice. Stopping attempts.`);
      throw new Error(`Failed to get gas price after ${failedCount} attempts`);
    }

    try {
      return await this.activeProvider.provider.getFeeData().then(data => data.gasPrice);
    } catch (error) {
      this.logger.error(`Error getting gas price: ${error.message}`);

      if (this.isConnectionError(error) && (await this.fallbackToNextAvailableProvider())) {
        return this.getGasPrice(failedCount + 1);
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

  /**
   * Get a provider for a specific chainId
   * @param chainId The chain ID (50 for Mainnet, 51 for Testnet)
   * @returns A provider for the specified chain
   */
  getProviderForChainId(chainId: number): ProviderWithMetadata | null {
    // First try to find the primary provider for this chain
    const primaryUrl = this.configService.getPrimaryRpcUrl(chainId);
    const primaryProvider = this.providers.get(primaryUrl);

    if (primaryProvider && primaryProvider.provider) {
      return primaryProvider;
    }

    // Otherwise, find any active provider for this chain
    for (const [, providerData] of this.providers.entries()) {
      if (providerData.endpoint.chainId === chainId && providerData.provider && providerData.endpoint.status === 'up') {
        return providerData;
      }
    }

    return null;
  }

  /**
   * Get a block by number from a specific chain
   * @param blockNumber The block number to retrieve
   * @param chainId The chain ID (50 for Mainnet, 51 for Testnet)
   * @returns Block information
   */
  async getBlockByNumberForChain(blockNumber: number, chainId: number): Promise<BlockInfo> {
    const providerData = this.getProviderForChainId(chainId);

    if (!providerData || !providerData.provider) {
      throw new Error(`No active provider found for chainId ${chainId}`);
    }

    try {
      const block = await providerData.provider.getBlock(blockNumber, true);

      if (!block) {
        throw new Error(`Block #${blockNumber} not found on chainId ${chainId}`);
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
      this.logger.error(`Error getting block #${blockNumber} on chainId ${chainId}: ${error.message}`);
      throw error;
    }
  }
}
