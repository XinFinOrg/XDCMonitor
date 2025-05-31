import { ConfigService } from '@config/config.service';
import { RpcSelectorService } from '@monitoring/rpc/rpc-selector.service';
import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import {
  AccountBalance,
  BlockInfo,
  ProviderWithMetadata,
  RpcEndpoint,
  TransactionInfo,
  TransactionStatus,
  WsProviderWithMetadata,
} from '@types';
import { ethers } from 'ethers';

@Injectable()
export class BlockchainService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(BlockchainService.name);
  private providers: Map<string, ProviderWithMetadata> = new Map();
  private wsProviders: Map<string, WsProviderWithMetadata> = new Map();
  private activeProvider: ProviderWithMetadata;
  private readonly MAX_FAILURES = 3;

  constructor(
    private readonly configService: ConfigService,
    private readonly rpcSelectorService?: RpcSelectorService,
  ) {
    // Initialize Map objects
    this.providers = new Map<string, ProviderWithMetadata>();
    this.wsProviders = new Map<string, WsProviderWithMetadata>();

    // Initialize providers first and set active provider later using onModuleInit
    this.logger.log('Providers will be initialized during module initialization...');
  }

  /**
   * NestJS lifecycle hook that runs after the module is initialized
   */
  async onModuleInit() {
    // Initialize all providers
    this.logger.log('Initializing all RPC and WebSocket providers...');
    await this.initializeProviders();

    // Set the active provider to the Mainnet primary one initially (for backward compatibility)
    const mainnetPrimaryUrl = this.configService.getPrimaryRpcUrl(50);
    const providerData = this.providers.get(mainnetPrimaryUrl);

    if (providerData) {
      this.activeProvider = providerData;
      this.logger.log(`Set active provider to ${providerData.endpoint.name} (${mainnetPrimaryUrl})`);
    } else {
      // Fallback to first available provider if primary not found
      if (this.providers.size > 0) {
        const firstProvider = Array.from(this.providers.values())[0];
        this.activeProvider = firstProvider;
        this.logger.log(
          `Fallback: Set active provider to ${firstProvider.endpoint.name} (${firstProvider.endpoint.url})`,
        );
      } else {
        this.logger.error('No providers available after initialization');
        // Create a minimal provider as fallback to prevent app crashes
        this.activeProvider = {
          provider: new ethers.JsonRpcProvider(mainnetPrimaryUrl),
          endpoint: {
            url: mainnetPrimaryUrl,
            name: 'Fallback Provider',
            type: 'rpc',
            chainId: 50,
            status: 'down',
          },
        };
      }
    }
  }

  /**
   * ✅ Clean up all providers to prevent memory leaks
   */
  async onModuleDestroy() {
    this.logger.log('Cleaning up blockchain providers...');

    // Clean up HTTP providers
    for (const [url, providerData] of this.providers.entries()) {
      if (providerData.provider) {
        try {
          // Remove all listeners
          providerData.provider.removeAllListeners();

          // Destroy the provider
          if (typeof providerData.provider.destroy === 'function') {
            await providerData.provider.destroy();
          }

          this.logger.debug(`Cleaned up provider: ${url}`);
        } catch (error) {
          this.logger.error(`Error cleaning up provider ${url}: ${error.message}`);
        }
      }
    }

    // Clean up WebSocket providers
    for (const [url, providerData] of this.wsProviders.entries()) {
      if (providerData.provider) {
        try {
          // Remove all listeners
          providerData.provider.removeAllListeners();

          // Close WebSocket connection
          const websocket = (providerData.provider as any).websocket || (providerData.provider as any)._websocket;
          if (websocket && typeof websocket.close === 'function') {
            websocket.close();
          }

          // Destroy the provider
          if (typeof providerData.provider.destroy === 'function') {
            await providerData.provider.destroy();
          }

          this.logger.debug(`Cleaned up WebSocket provider: ${url}`);
        } catch (error) {
          this.logger.error(`Error cleaning up WebSocket provider ${url}: ${error.message}`);
        }
      }
    }

    // Clear the maps
    this.providers.clear();
    this.wsProviders.clear();

    this.logger.log('All providers cleaned up successfully');
  }

  /**
   * Initialize RPC and WebSocket providers for all endpoints
   * This method is called during initialization but can also be called
   * by monitoring services to refresh provider status
   */
  public async initializeProviders(): Promise<void> {
    this.logger.log('Initializing blockchain providers...');

    const endpoints = this.configService.getRpcEndpoints();
    this.logger.log(`Found ${endpoints.length} RPC endpoints`);

    const wsEndpoints = this.configService.getWsEndpoints();
    this.logger.log(`Found ${wsEndpoints.length} WebSocket endpoints: ${JSON.stringify(wsEndpoints.map(e => e.url))}`);

    for (const endpoint of endpoints) {
      try {
        if (!endpoint.url || !endpoint.url.startsWith('http')) {
          this.logger.warn(`Invalid RPC URL: ${endpoint.url}`);
          this.providers.set(endpoint.url, {
            provider: null,
            endpoint: { ...endpoint, status: 'down' },
          });
          continue;
        }

        // Use a timeout for provider creation
        const provider = new ethers.JsonRpcProvider(endpoint.url, undefined, {
          staticNetwork: true,
          polling: false,
          cacheTimeout: 10000,
        });

        // ✅ Add error handling for provider to prevent memory leaks
        provider.on('error', error => {
          this.logger.error(`Provider error for ${endpoint.name}: ${error.message}`);
          this.updateProviderStatus(endpoint.url, false);
        });

        // Test the provider with a basic call
        const networkPromise = provider.getNetwork();
        const networkTimeout = new Promise((_, reject) =>
          setTimeout(() => reject(new Error('Network detection timeout')), 5000),
        );

        await Promise.race([networkPromise, networkTimeout]);

        this.providers.set(endpoint.url, { provider, endpoint: { ...endpoint, status: 'up' } });
        this.logger.log(`Initialized RPC provider: ${endpoint.name} (${endpoint.url})`);
      } catch (error) {
        this.logger.error(`Failed to initialize provider ${endpoint.name}: ${error.message}`);
        this.providers.set(endpoint.url, {
          provider: null,
          endpoint: { ...endpoint, status: 'down' },
        });
      }
    }

    for (const endpoint of wsEndpoints) {
      this.initializeWebSocketProvider(endpoint);
    }

    // Test all providers after initialization
    await this.testAllProviders();
  }

  /**
   * Tests all providers and updates their status
   */
  private async testAllProviders(): Promise<void> {
    this.logger.debug('Testing all providers...');

    const testPromises = Array.from(this.providers.entries()).map(async ([url, providerData]) => {
      if (!providerData.provider) {
        return;
      }

      try {
        await providerData.provider.getBlockNumber();
        providerData.endpoint.status = 'up';
        this.logger.debug(`Provider ${providerData.endpoint.name} (${url}) is UP`);
      } catch (error) {
        providerData.endpoint.status = 'down';
        this.logger.warn(`Provider ${providerData.endpoint.name} (${url}) is DOWN: ${error.message}`);
      }
    });

    await Promise.all(testPromises);
  }

  /**
   * Initialize a WebSocket provider for an endpoint
   */
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

  /**
   * Get an ethers provider for a specific URL
   * @param url The RPC endpoint URL
   * @returns The provider if available, or null
   */
  getProviderByUrl(url: string): ethers.JsonRpcProvider | null {
    const providerData = this.providers.get(url);
    return providerData ? providerData.provider : null;
  }

  /**
   * Get provider metadata for a specific URL
   * This is useful for RPC monitoring services that need the full provider info
   * @param url The RPC endpoint URL
   * @returns The provider metadata if available, or null
   */
  getProviderMetadataByUrl(url: string): ProviderWithMetadata | null {
    return this.providers.get(url) || null;
  }

  /**
   * Get a WebSocket provider for a specific URL
   * @param url The WebSocket endpoint URL
   * @returns The WebSocket provider if available, or null
   */
  getWsProviderByUrl(url: string): ethers.WebSocketProvider | null {
    const providerData = this.wsProviders.get(url);
    return providerData ? providerData.provider : null;
  }

  /**
   * Get WebSocket provider metadata for a specific URL
   * @param url The WebSocket endpoint URL
   * @returns The WebSocket provider metadata if available, or null
   */
  getWsProviderMetadataByUrl(url: string): WsProviderWithMetadata | null {
    return this.wsProviders.get(url) || null;
  }

  /**
   * Get all RPC providers with their metadata
   * This is useful for services that need to iterate through all providers
   */
  getAllProviders(): ProviderWithMetadata[] {
    return Array.from(this.providers.values());
  }

  /**
   * Get all WebSocket providers with their metadata
   * This is useful for services that need to iterate through all WS providers
   */
  getAllWsProviders(): WsProviderWithMetadata[] {
    return Array.from(this.wsProviders.values());
  }

  /**
   * Set the active provider for blockchain operations
   * @param url The URL of the provider to set as active
   * @returns Whether the provider was successfully set
   */
  setActiveProvider(url: string): boolean {
    const providerData = this.providers.get(url);
    if (providerData && providerData.provider) {
      this.activeProvider = providerData;
      this.logger.log(`Switched active provider to ${providerData.endpoint.name} (${url})`);
      return true;
    }
    return false;
  }

  /**
   * Get the currently active provider
   */
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
          this.logger.warn(
            `Chain ${providerData.endpoint.chainId} provider ${providerData.endpoint.name} - ${providerData.endpoint.url} is not responding, trying next...`,
          );
          providerData.endpoint.status = 'down';
        }
      }
    }

    this.logger.warn(`No more available providers to try.`);
    return false;
  }

  /**
   * Get the latest block from a specific chain
   * @param chainId The chain ID to get the block from
   * @returns The latest block information
   */
  async getLatestBlock(chainId: number): Promise<BlockInfo> {
    const providerData = this.getProviderForChainId(chainId);
    if (!providerData || !providerData.provider) {
      throw new Error(`No provider available for chain ${chainId}`);
    }

    const blockNumber = await providerData.provider.getBlockNumber();
    return this.getBlockByNumberForChain(blockNumber, chainId);
  }

  /**
   * Get the latest block number from a specific chain
   * @param chainId The chain ID to get the block number from
   * @param url Optional specific endpoint URL to use
   * @returns The latest block number
   */
  async getLatestBlockNumber(chainId: number, url?: string): Promise<number> {
    try {
      let provider: ethers.JsonRpcProvider;

      if (url) {
        // If a specific URL is provided, use that provider
        provider = this.getProviderByUrl(url);
        if (!provider) {
          throw new Error(`No provider found for URL: ${url}`);
        }
      } else {
        // Use chain-specific provider
        const providerData = this.getProviderForChainId(chainId);
        if (!providerData || !providerData.provider) {
          throw new Error(`No provider available for chain ${chainId}`);
        }
        provider = providerData.provider;
      }

      const blockNumber = await provider.getBlockNumber();
      return blockNumber;
    } catch (error) {
      this.logger.error(`Error getting latest block number for chain ${chainId}: ${error.message}`);
      throw error;
    }
  }

  /**
   * Get account balance from a specific chain
   * @param address The address to get the balance for
   * @param chainId The chain ID to get the balance from
   * @param failedCount Tracking retry attempts
   * @returns The account balance information
   */
  async getBalance(address: string, chainId: number, failedCount: number = 0): Promise<AccountBalance> {
    if (failedCount >= this.MAX_FAILURES) {
      this.logger.warn(`Maximum failure count (${this.MAX_FAILURES}) reached for getBalance. Stopping attempts.`);
      throw new Error(`Failed to get balance for ${address} on chain ${chainId} after ${failedCount} attempts`);
    }

    try {
      const providerData = this.getProviderForChainId(chainId);
      if (!providerData || !providerData.provider) {
        throw new Error(`No provider available for chain ${chainId}`);
      }

      const balance = await providerData.provider.getBalance(address);
      const blockNumber = await providerData.provider.getBlockNumber();

      return {
        address,
        balance,
        blockNumber,
      };
    } catch (error) {
      this.logger.error(`Error getting balance for ${address} on chain ${chainId}: ${error.message}`);

      if (this.isConnectionError(error)) {
        // Try to find another provider for this chain
        const nextProvider = this.getNextAvailableProviderForChain(chainId);
        if (nextProvider) {
          this.logger.log(`Trying next provider for chain ${chainId}: ${nextProvider.endpoint.name}`);
          return this.getBalance(address, chainId, failedCount + 1);
        }
      }

      throw error;
    }
  }

  /**
   * Get transaction details from a specific chain
   * @param hash The transaction hash
   * @param chainId The chain ID to get the transaction from
   * @param failedCount Tracking retry attempts
   * @returns The transaction information
   */
  async getTransaction(hash: string, chainId: number, failedCount: number = 0): Promise<TransactionInfo> {
    if (failedCount >= this.MAX_FAILURES) {
      this.logger.warn(`Maximum failure count (${this.MAX_FAILURES}) reached for getTransaction. Stopping attempts.`);
      throw new Error(`Failed to get transaction ${hash} on chain ${chainId} after ${failedCount} attempts`);
    }

    try {
      const providerData = this.getProviderForChainId(chainId);
      if (!providerData || !providerData.provider) {
        throw new Error(`No provider available for chain ${chainId}`);
      }

      const provider = providerData.provider;
      const tx = await provider.getTransaction(hash);

      if (!tx) {
        throw new Error(`Chain ${chainId} transaction ${hash} not found`);
      }

      const receipt = await provider.getTransactionReceipt(hash);

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
      this.logger.error(`Error getting transaction ${hash} on chain ${chainId}: ${error.message}`);

      if (!error.message.includes('not found') && this.isConnectionError(error)) {
        // Try to find another provider for this chain
        const nextProvider = this.getNextAvailableProviderForChain(chainId);
        if (nextProvider) {
          this.logger.log(`Trying next provider for chain ${chainId}: ${nextProvider.endpoint.name}`);
          return this.getTransaction(hash, chainId, failedCount + 1);
        }
      }

      throw error;
    }
  }

  /**
   * Find another available provider for a specific chain
   * @param chainId The chain ID to find a provider for
   * @returns The next available provider for the chain, or null if none found
   */
  private getNextAvailableProviderForChain(chainId: number): ProviderWithMetadata | null {
    const chainsProviders = Array.from(this.providers.values()).filter(
      p => p.endpoint.chainId === chainId && p.endpoint.status === 'up' && p.provider,
    );

    // Shuffle the providers to avoid always trying them in the same order
    const shuffled = chainsProviders.sort(() => 0.5 - Math.random());

    return shuffled[0] || null;
  }

  /**
   * @deprecated Use getTransaction with chainId parameter instead
   * Kept for backward compatibility
   */
  async getTransactionForChain(hash: string, chainId: number): Promise<TransactionInfo> {
    return this.getTransaction(hash, chainId);
  }

  /**
   * Get transaction count for an address on a specific chain
   * @param address The address to get the transaction count for
   * @param chainId The chain ID to get the transaction count from
   * @param failedCount Tracking retry attempts
   * @returns The transaction count
   */
  async getTransactionCount(address: string, chainId: number, failedCount: number = 0): Promise<number> {
    if (failedCount >= this.MAX_FAILURES) {
      this.logger.warn(
        `Maximum failure count (${this.MAX_FAILURES}) reached for getTransactionCount. Stopping attempts.`,
      );
      throw new Error(
        `Failed to get transaction count for ${address} on chain ${chainId} after ${failedCount} attempts`,
      );
    }

    try {
      const providerData = this.getProviderForChainId(chainId);
      if (!providerData || !providerData.provider) {
        throw new Error(`No provider available for chain ${chainId}`);
      }

      return await providerData.provider.getTransactionCount(address);
    } catch (error) {
      this.logger.error(`Error getting transaction count for ${address} on chain ${chainId}: ${error.message}`);

      if (this.isConnectionError(error)) {
        // Try to find another provider for this chain
        const nextProvider = this.getNextAvailableProviderForChain(chainId);
        if (nextProvider) {
          this.logger.log(`Trying next provider for chain ${chainId}: ${nextProvider.endpoint.name}`);
          return this.getTransactionCount(address, chainId, failedCount + 1);
        }
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
   * Get a provider for a specific chain ID
   * @param chainId The chain ID (50 for Mainnet, 51 for Testnet)
   * @returns A provider for the specified chain
   */
  getProviderForChainId(chainId: number): ProviderWithMetadata | null {
    // First try to get the best provider URL from the selector service (if available)
    let primaryUrl: string;

    if (this.rpcSelectorService) {
      // Use the dynamic selection service if available
      primaryUrl = this.rpcSelectorService.getPrimaryRpcUrl(chainId);
    } else {
      // Fall back to the static config
      primaryUrl = this.configService.getPrimaryRpcUrl(chainId);
    }

    // Try to get the primary provider
    const primaryProvider = this.providers.get(primaryUrl);

    if (primaryProvider && primaryProvider.provider && primaryProvider.endpoint.status === 'up') {
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
   * Get a block by number for a specific chain
   */
  async getBlockByNumberForChain(blockNumber: number, chainId: number): Promise<BlockInfo> {
    const providerData = this.getProviderForChainId(chainId);

    if (!providerData) {
      const errorMsg = `No active provider found for chain ID ${chainId}`;
      this.logger.error(errorMsg);
      throw new Error(errorMsg);
    }

    if (!providerData.provider) {
      const errorMsg = `Provider exists but is not initialized for chain ID ${chainId}`;
      this.logger.error(errorMsg);
      throw new Error(errorMsg);
    }

    try {
      // Convert block number to hex
      const blockParam = `0x${blockNumber.toString(16)}`;

      // Get block with transactions as objects
      const block = await providerData.provider.send('eth_getBlockByNumber', [blockParam, true]);

      if (!block) {
        throw new Error(`Block ${blockNumber} not found on chain ${chainId}`);
      }

      // Parse block data
      const timestamp = parseInt(block.timestamp, 16) * 1000; // Convert to milliseconds

      // Ensure number is properly set
      const parsedBlockNumber = block.number ? parseInt(block.number, 16) : blockNumber;

      // Extract transaction hashes and data
      const transactions = Array.isArray(block.transactions)
        ? block.transactions.map(tx => {
            if (typeof tx === 'string') {
              return tx;
            }
            // If we have a full transaction object, extract the hash
            return tx.hash || '';
          })
        : [];

      // Log transaction count for debugging
      this.logger.debug(`Block #${parsedBlockNumber} has ${transactions.length} transactions on chain ${chainId}`);

      // Convert gas values from hex to BigInt
      const gasUsed = block.gasUsed ? BigInt(block.gasUsed) : BigInt(0);
      const gasLimit = block.gasLimit ? BigInt(block.gasLimit) : BigInt(0);

      return {
        number: parsedBlockNumber,
        hash: block.hash || '',
        parentHash: block.parentHash || '',
        timestamp,
        transactions,
        gasUsed,
        gasLimit,
        miner: block.miner || '',
      };
    } catch (error) {
      this.logger.error(`Failed to get block ${blockNumber} for chain ${chainId}: ${error.message}`);
      throw error;
    }
  }

  /**
   * Send a normal transaction
   * @param privateKey The private key to sign the transaction
   * @param to The recipient address
   * @param value The amount to send in XDC
   * @param chainId The chain ID (50 for mainnet, 51 for testnet)
   * @param rpcUrl Optional specific RPC URL to use for this transaction
   * @returns The transaction receipt
   */
  async sendTransaction(privateKey: string, to: string, value: string, chainId: number = 50, rpcUrl?: string) {
    this.logger.debug(`Preparing to send ${value} XDC to ${to} on chain ${chainId}${rpcUrl ? ` via ${rpcUrl}` : ''}`);

    // Use ethers.js to create and send a transaction
    const provider = rpcUrl ? this.getProviderByUrl(rpcUrl) : this.getProviderForChain(chainId);

    if (!provider) {
      throw new Error(`No provider available for ${rpcUrl || 'chainId ' + chainId}`);
    }

    const wallet = new ethers.Wallet(privateKey, provider);

    const valueInWei = ethers.parseEther(value);

    const tx = await wallet.sendTransaction({
      to: to,
      value: valueInWei,
      // Let ethers estimate gas price and limit
    });

    this.logger.debug(`Transaction sent with hash: ${tx.hash}`);

    // Wait for transaction to be mined (1 confirmation)
    const receipt = await tx.wait(1);

    return {
      transactionHash: tx.hash,
      blockNumber: receipt.blockNumber,
      gasUsed: Number(receipt.gasUsed),
      status: receipt.status === 1 ? TransactionStatus.CONFIRMED : TransactionStatus.FAILED,
    };
  }

  /**
   * Deploy a smart contract
   * @param privateKey The private key to sign the transaction
   * @param bytecode The contract bytecode
   * @param constructorArgs The constructor arguments (if any)
   * @param chainId The chain ID (50 for mainnet, 51 for testnet)
   * @param rpcUrl Optional specific RPC URL to use for this deployment
   * @returns The transaction receipt and contract address
   */
  async deployContract(
    privateKey: string,
    bytecode: string,
    constructorArgs: any[] = [],
    chainId: number = 50,
    rpcUrl?: string,
  ) {
    this.logger.debug(`Preparing to deploy contract on chain ${chainId}${rpcUrl ? ` via ${rpcUrl}` : ''}`);

    // Use ethers.js to deploy a contract
    const provider = rpcUrl ? this.getProviderByUrl(rpcUrl) : this.getProviderForChain(chainId);

    if (!provider) {
      throw new Error(`No provider available for ${rpcUrl || 'chainId ' + chainId}`);
    }

    const wallet = new ethers.Wallet(privateKey, provider);

    // Create contract factory
    const factory = new ethers.ContractFactory(
      [], // ABI not needed for deployment
      bytecode,
      wallet,
    );

    // Deploy the contract
    const contract = await factory.deploy(...constructorArgs);
    const deployTx = contract.deploymentTransaction();
    this.logger.debug(`Contract deployment transaction sent with hash: ${deployTx.hash}`);

    // Wait for deployment to be mined
    const receipt = await deployTx.wait(1);

    return {
      transactionHash: deployTx.hash,
      contractAddress: await contract.getAddress(),
      blockNumber: receipt.blockNumber,
      gasUsed: Number(receipt.gasUsed),
      status: receipt.status === 1 ? TransactionStatus.CONFIRMED : TransactionStatus.FAILED,
    };
  }

  /**
   * Get a provider for a specific chain
   * @param chainId The chain ID (50 for mainnet, 51 for testnet)
   * @returns A provider for the specified chain
   */
  getProviderForChain(chainId: number): ethers.JsonRpcProvider {
    const providerData = this.getProviderForChainId(chainId);

    if (!providerData || !providerData.provider) {
      throw new Error(`No active provider found for chainId ${chainId}`);
    }

    return providerData.provider;
  }

  /**
   * Update provider status based on monitoring results
   * This method is called by RpcMonitorService when it detects endpoint issues
   * @param url The RPC endpoint URL
   * @param isUp Whether the endpoint is responding
   */
  updateProviderStatus(url: string, isUp: boolean): void {
    const providerData = this.providers.get(url);
    if (providerData) {
      const previousStatus = providerData.endpoint.status;
      providerData.endpoint.status = isUp ? 'up' : 'down';

      if (previousStatus !== providerData.endpoint.status) {
        this.logger.log(
          `Provider status changed: ${providerData.endpoint.name} (${url}) is now ${providerData.endpoint.status}`,
        );

        // If the active provider went down, consider switching
        if (!isUp && this.activeProvider.endpoint.url === url) {
          this.logger.warn(`Active provider ${providerData.endpoint.name} is down, attempting to switch...`);
          this.fallbackToNextAvailableProvider();
        }
      }
    }
  }

  /**
   * Update WebSocket provider status based on monitoring results
   * This method is called by RpcMonitorService when it detects endpoint issues
   * @param url The WebSocket endpoint URL
   * @param isUp Whether the endpoint is responding
   */
  updateWsProviderStatus(url: string, isUp: boolean): void {
    const providerData = this.wsProviders.get(url);
    if (providerData) {
      const previousStatus = providerData.endpoint.status;
      providerData.endpoint.status = isUp ? 'up' : 'down';

      if (previousStatus !== providerData.endpoint.status) {
        this.logger.log(
          `WebSocket provider status changed: ${providerData.endpoint.name} (${url}) is now ${providerData.endpoint.status}`,
        );
      }
    }
  }
}
