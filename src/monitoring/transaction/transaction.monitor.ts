import { BlockchainService } from '@blockchain/blockchain.service';
import { ConfigService } from '@config/config.service';
import { MetricsService } from '@metrics/metrics.service';
import { AlertService } from '@alerts/alert.service';
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { TransactionStatus } from '@types';
import { ethers } from 'ethers';
import { ALERTS } from '@common/constants/config';

@Injectable()
export class TransactionMonitorService implements OnModuleInit {
  private readonly logger = new Logger(TransactionMonitorService.name);
  private testWallets = {}; // Will store test wallets for different networks

  // Minimum balance required for testing (in XDC)
  private readonly MIN_BALANCE_THRESHOLD = '0.01';

  // Sample contract bytecode for deployment tests (simple storage contract)
  private readonly TEST_CONTRACT_BYTECODE =
    '6080604052348015600e575f80fd5b506101438061001c5f395ff3fe608060405234801561000f575f80fd5b5060043610610034575f3560e01c80632e64cec1146100385780636057361d14610056575b5f80fd5b610040610072565b60405161004d919061009b565b60405180910390f35b610070600480360381019061006b91906100e2565b61007a565b005b5f8054905090565b805f8190555050565b5f819050919050565b61009581610083565b82525050565b5f6020820190506100ae5f83018461008c565b92915050565b5f80fd5b6100c181610083565b81146100cb575f80fd5b50565b5f813590506100dc816100b8565b92915050565b5f602082840312156100f7576100f66100b4565b5b5f610104848285016100ce565b9150509291505056fea26469706673582212209a0dd35336aff1eb3eeb11db76aa60a1427a12c1b92f945ea8c8d1dfa337cf2264736f6c634300081a0033';

  constructor(
    private readonly blockchainService: BlockchainService,
    private readonly configService: ConfigService,
    private readonly metricsService: MetricsService,
    private readonly alertService: AlertService,
  ) {}

  async onModuleInit() {
    if (this.configService.enableTransactionMonitoring) {
      this.logger.log('Transaction monitor initialized');
      await this.initializeTestWallets();

      const disabledEndpoints = this.configService.getTransactionTestDisabledEndpoints();
      if (disabledEndpoints.length > 0) {
        this.logger.log(`Transaction tests disabled for endpoints: ${disabledEndpoints.join(', ')}`);
      }
    }
  }

  private async initializeTestWallets() {
    // Initialize test wallets with private keys from config for different networks
    // These should be test accounts with some XDC balance
    this.testWallets = {
      50: {
        privateKey: this.configService.mainnetTestPrivateKey,
        address: this.getAddressFromPrivateKey(this.configService.mainnetTestPrivateKey),
        hasBalance: false,
      },
      51: {
        privateKey: this.configService.testnetTestPrivateKey,
        address: this.getAddressFromPrivateKey(this.configService.testnetTestPrivateKey),
        hasBalance: false,
      },
    };

    this.logger.log('Test wallets initialized for transaction monitoring');

    // Initial balance check
    await this.checkWalletBalances();
  }

  /**
   * Derive wallet address from private key
   */
  private getAddressFromPrivateKey(privateKey: string): string {
    if (!privateKey) {
      this.logger.warn('No private key provided');
      return '';
    }

    try {
      // Ensure private key has proper format
      const formattedKey = privateKey.startsWith('0x') ? privateKey : `0x${privateKey}`;

      // Validate private key length (should be 32 bytes / 64 hex chars after 0x)
      if (formattedKey.length !== 66) {
        this.logger.error(`Invalid private key length: ${formattedKey.length - 2} characters, expected 64`);
        return '';
      }

      const wallet = new ethers.Wallet(formattedKey);
      return wallet.address;
    } catch (error) {
      this.logger.error(`Failed to derive address from private key: ${error.message}`);
      return '';
    }
  }

  async checkWalletBalances() {
    this.logger.debug('Checking test wallet balances');

    // Check mainnet wallet balance
    await this.checkWalletBalance(50);

    // Check testnet wallet balance
    await this.checkWalletBalance(51);
  }

  /**
   * Check balance of a specific wallet
   */
  private async checkWalletBalance(chainId: number) {
    const wallet = this.testWallets[chainId];
    if (!wallet || !wallet.address) {
      this.logger.warn(`No valid test wallet found for chainId ${chainId}`);
      return;
    }

    const chainName = chainId === 50 ? 'Mainnet' : 'Testnet';

    try {
      // Get a provider for this chain
      const providerData = this.blockchainService.getProviderForChainId(chainId);
      if (!providerData || !providerData.provider) {
        this.logger.warn(`No provider available for ${chainName}`);
        wallet.hasBalance = false;
        return;
      }

      // Get balance
      const balanceWei = await providerData.provider.getBalance(wallet.address);
      const balanceXdc = ethers.formatEther(balanceWei);

      // Check if balance is sufficient
      const minBalance = this.MIN_BALANCE_THRESHOLD;
      const hasEnoughBalance = parseFloat(balanceXdc) >= parseFloat(minBalance);

      wallet.hasBalance = hasEnoughBalance;

      // Log balance info
      if (hasEnoughBalance) {
        this.logger.log(`${chainName} test wallet (${wallet.address}) has sufficient balance: ${balanceXdc} XDC`);
      } else {
        this.logger.warn(
          `${chainName} test wallet (${wallet.address}) has insufficient balance: ${balanceXdc} XDC (minimum: ${minBalance} XDC)`,
        );
      }

      // Record balance metric
      this.metricsService.setWalletBalance(chainId, balanceXdc, hasEnoughBalance);
    } catch (error) {
      this.logger.error(`Failed to check ${chainName} wallet balance: ${error.message}`);
      wallet.hasBalance = false;
    }
  }

  @Cron('0 */5 * * * *') // Run every 5 minutes
  async executeTransactionTests() {
    if (!this.configService.enableTransactionMonitoring) {
      return;
    }

    this.logger.debug('Running scheduled transaction tests');

    // Force check wallet balances before running tests
    await this.checkWalletBalances();

    // Get all active RPC providers
    const mainnetProviders = this.blockchainService
      .getAllProviders()
      .filter(
        providerData =>
          providerData.endpoint.chainId === 50 &&
          providerData.endpoint.status === 'up' &&
          providerData.provider !== null,
      );

    const testnetProviders = this.blockchainService
      .getAllProviders()
      .filter(
        providerData =>
          providerData.endpoint.chainId === 51 &&
          providerData.endpoint.status === 'up' &&
          providerData.provider !== null,
      );

    // Filter out disabled endpoints
    const enabledMainnetProviders = this.filterEnabledProviders(mainnetProviders);
    const enabledTestnetProviders = this.filterEnabledProviders(testnetProviders);

    // Track transaction success/failure rates for each network and transaction type
    const results = {
      50: {
        // Mainnet
        normalTransaction: { success: 0, failure: 0, total: 0, failedEndpoints: [] },
        contractDeployment: { success: 0, failure: 0, total: 0, failedEndpoints: [] },
      },
      51: {
        // Testnet
        normalTransaction: { success: 0, failure: 0, total: 0, failedEndpoints: [] },
        contractDeployment: { success: 0, failure: 0, total: 0, failedEndpoints: [] },
      },
    };

    // Test each active mainnet RPC with both transaction types if wallet has enough balance
    if (this.testWallets[50].hasBalance) {
      for (const providerData of enabledMainnetProviders) {
        // Run normal transaction test
        const normalTxResult = await this.runTransactionTest(50, false, providerData.endpoint.url);
        results[50].normalTransaction.total++;
        if (normalTxResult) {
          results[50].normalTransaction.success++;
        } else {
          results[50].normalTransaction.failure++;
          results[50].normalTransaction.failedEndpoints.push(providerData.endpoint.url);
        }

        // Run contract deployment test
        const contractTxResult = await this.runTransactionTest(50, true, providerData.endpoint.url);
        results[50].contractDeployment.total++;
        if (contractTxResult) {
          results[50].contractDeployment.success++;
        } else {
          results[50].contractDeployment.failure++;
          results[50].contractDeployment.failedEndpoints.push(providerData.endpoint.url);
        }
      }
    } else {
      this.logger.warn('Skipping Mainnet transaction tests due to insufficient wallet balance');
      this.alertService.warning(
        ALERTS.TYPES.INSUFFICIENT_WALLET_BALANCE,
        ALERTS.COMPONENTS.TRANSACTION,
        `Mainnet test wallet (${this.testWallets[50].address}) has insufficient balance for transaction tests`,
        50,
      );
    }

    // Test each active testnet RPC with both transaction types if wallet has enough balance
    if (this.testWallets[51].hasBalance) {
      for (const providerData of enabledTestnetProviders) {
        // Run normal transaction test
        const normalTxResult = await this.runTransactionTest(51, false, providerData.endpoint.url);
        results[51].normalTransaction.total++;
        if (normalTxResult) {
          results[51].normalTransaction.success++;
        } else {
          results[51].normalTransaction.failure++;
          results[51].normalTransaction.failedEndpoints.push(providerData.endpoint.url);
        }

        // Run contract deployment test
        const contractTxResult = await this.runTransactionTest(51, true, providerData.endpoint.url);
        results[51].contractDeployment.total++;
        if (contractTxResult) {
          results[51].contractDeployment.success++;
        } else {
          results[51].contractDeployment.failure++;
          results[51].contractDeployment.failedEndpoints.push(providerData.endpoint.url);
        }
      }
    } else {
      this.logger.warn('Skipping Testnet transaction tests due to insufficient wallet balance');
      this.alertService.warning(
        ALERTS.TYPES.INSUFFICIENT_WALLET_BALANCE,
        ALERTS.COMPONENTS.TRANSACTION,
        `Testnet test wallet (${this.testWallets[51].address}) has insufficient balance for transaction tests`,
        51,
      );
    }

    // Check failure rates and generate alerts if needed
    this.checkFailureRatesAndAlert(results);
  }

  /**
   * Check transaction failure rates across RPC endpoints and generate alerts if necessary
   */
  private checkFailureRatesAndAlert(results: any) {
    // Check Mainnet normal transactions
    if (results[50].normalTransaction.total > 0) {
      const failureRate = results[50].normalTransaction.failure / results[50].normalTransaction.total;
      if (failureRate >= 0.5) {
        // 50% or more failed
        // Format the list of failed endpoints for better readability
        const failedEndpointsList = results[50].normalTransaction.failedEndpoints
          .map(endpoint => `\n  - ${endpoint}`)
          .join('');

        this.alertService.error(
          ALERTS.TYPES.TRANSACTION_FAILURE_RATE_HIGH,
          ALERTS.COMPONENTS.TRANSACTION,
          `High transaction failure rate on Mainnet: ${results[50].normalTransaction.failure}/${results[50].normalTransaction.total} (${Math.round(failureRate * 100)}%) RPC endpoints failed to process normal transactions.\n\nFailed endpoints:${failedEndpointsList}`,
          50,
        );
      }
    }

    // Check Mainnet contract deployments
    if (results[50].contractDeployment.total > 0) {
      const failureRate = results[50].contractDeployment.failure / results[50].contractDeployment.total;
      if (failureRate >= 0.5) {
        // 50% or more failed
        // Format the list of failed endpoints for better readability
        const failedEndpointsList = results[50].contractDeployment.failedEndpoints
          .map(endpoint => `\n  - ${endpoint}`)
          .join('');

        this.alertService.error(
          ALERTS.TYPES.TRANSACTION_FAILURE_RATE_HIGH,
          ALERTS.COMPONENTS.TRANSACTION,
          `High contract deployment failure rate on Mainnet: ${results[50].contractDeployment.failure}/${results[50].contractDeployment.total} (${Math.round(failureRate * 100)}%) RPC endpoints failed to deploy contracts.\n\nFailed endpoints:${failedEndpointsList}`,
          50,
        );
      }
    }

    // Check Testnet normal transactions
    if (results[51].normalTransaction.total > 0) {
      const failureRate = results[51].normalTransaction.failure / results[51].normalTransaction.total;
      if (failureRate >= 0.5) {
        // 50% or more failed
        // Format the list of failed endpoints for better readability
        const failedEndpointsList = results[51].normalTransaction.failedEndpoints
          .map(endpoint => `\n  - ${endpoint}`)
          .join('');

        this.alertService.error(
          ALERTS.TYPES.TRANSACTION_FAILURE_RATE_HIGH,
          ALERTS.COMPONENTS.TRANSACTION,
          `High transaction failure rate on Testnet: ${results[51].normalTransaction.failure}/${results[51].normalTransaction.total} (${Math.round(failureRate * 100)}%) RPC endpoints failed to process normal transactions.\n\nFailed endpoints:${failedEndpointsList}`,
          51,
        );
      }
    }

    // Check Testnet contract deployments
    if (results[51].contractDeployment.total > 0) {
      const failureRate = results[51].contractDeployment.failure / results[51].contractDeployment.total;
      if (failureRate >= 0.5) {
        // 50% or more failed
        // Format the list of failed endpoints for better readability
        const failedEndpointsList = results[51].contractDeployment.failedEndpoints
          .map(endpoint => `\n  - ${endpoint}`)
          .join('');

        this.alertService.error(
          ALERTS.TYPES.TRANSACTION_FAILURE_RATE_HIGH,
          ALERTS.COMPONENTS.TRANSACTION,
          `High contract deployment failure rate on Testnet: ${results[51].contractDeployment.failure}/${results[51].contractDeployment.total} (${Math.round(failureRate * 100)}%) RPC endpoints failed to deploy contracts.\n\nFailed endpoints:${failedEndpointsList}`,
          51,
        );
      }
    }

    // Log summary of transaction test results
    this.logger.log(
      `Transaction test summary - Mainnet: Normal ${results[50].normalTransaction.success}/${results[50].normalTransaction.total} successful, Contract ${results[50].contractDeployment.success}/${results[50].contractDeployment.total} successful`,
    );
    this.logger.log(
      `Transaction test summary - Testnet: Normal ${results[51].normalTransaction.success}/${results[51].normalTransaction.total} successful, Contract ${results[51].contractDeployment.success}/${results[51].contractDeployment.total} successful`,
    );
  }

  private async runTransactionTest(chainId: number, deployContract: boolean, rpcUrl?: string) {
    const chainName = chainId === 50 ? 'Mainnet' : 'Testnet';
    let success = false;
    let txHash = '';

    let startTime = Date.now();
    try {
      // Double check wallet has balance (in case it was drained during testing)
      if (!this.testWallets[chainId].hasBalance) {
        throw new Error(`Insufficient balance in ${chainName} test wallet`);
      }

      if (deployContract) {
        // Deploy test contract
        this.logger.debug(`Deploying test contract on ${chainName} ${rpcUrl} (chainId: ${chainId})`);
        startTime = Date.now();
        const result = await this.blockchainService.deployContract(
          this.testWallets[chainId].privateKey,
          this.TEST_CONTRACT_BYTECODE,
          [],
          chainId,
          rpcUrl,
        );

        txHash = result.transactionHash;
      } else {
        // Send normal test transaction
        this.logger.debug(`Sending normal test transaction on ${chainName} ${rpcUrl} (chainId: ${chainId})`);

        // Get a receiving address (could be another test wallet)
        const receiverAddress = this.configService.getTestReceiverAddress(chainId);

        startTime = Date.now();
        const result = await this.blockchainService.sendTransaction(
          this.testWallets[chainId].privateKey,
          receiverAddress,
          '0.0001', // Small test amount
          chainId,
          rpcUrl,
        );

        txHash = result.transactionHash;
      }

      // ✅ Optimized transaction confirmation with exponential backoff
      let txConfirmed = false;
      let attempts = 0;
      const maxAttempts = 8; // Reduced from 10
      let backoffMs = 1000; // Start with 1 second

      while (!txConfirmed && attempts < maxAttempts) {
        try {
          const tx = await this.blockchainService.getTransaction(txHash, chainId, attempts);
          if (tx && tx.status === TransactionStatus.CONFIRMED) {
            txConfirmed = true;
            break;
          } else if (tx && tx.status === TransactionStatus.FAILED) {
            // Transaction failed, no need to keep checking
            this.logger.warn(`Transaction ${txHash} failed on ${chainName}`);
            break;
          }
        } catch (error) {
          // If we can't get transaction info, log and continue
          this.logger.debug(`Attempt ${attempts + 1}: Could not get transaction ${txHash}: ${error.message}`);
        }

        attempts++;

        // ✅ Exponential backoff to reduce API calls and async hooks
        if (attempts < maxAttempts) {
          await new Promise(resolve => setTimeout(resolve, backoffMs));
          backoffMs = Math.min(backoffMs * 1.5, 10000); // Cap at 10 seconds
        }
      }

      success = txConfirmed;
      const duration = Date.now() - startTime;

      // Record metrics
      this.metricsService.setTransactionMonitorResult(
        deployContract ? 'contract_deployment' : 'normal_transaction',
        success,
        duration,
        chainId,
        rpcUrl,
      );

      this.logger.log(
        `Transaction test ${success ? 'successful' : 'failed'} on ${chainName} ${rpcUrl}: ` +
          `Type: ${deployContract ? 'Contract Deployment' : 'Normal Transaction'}, ` +
          `Duration: ${duration}ms`,
      );
    } catch (error) {
      this.logger.error(
        `Transaction test failed on ${chainName} ${rpcUrl}: ` +
          `Type: ${deployContract ? 'Contract Deployment' : 'Normal Transaction'}, ` +
          `Error: ${error.message}`,
      );

      this.metricsService.setTransactionMonitorResult(
        deployContract ? 'contract_deployment' : 'normal_transaction',
        false,
        Date.now() - startTime,
        chainId,
        rpcUrl,
      );
    }

    return success;
  }

  /**
   * Public method to get current test wallet status for testing
   */
  public getTestWalletStatus(): any {
    return {
      mainnet: {
        address: this.testWallets[50]?.address,
        hasBalance: this.testWallets[50]?.hasBalance || false,
      },
      testnet: {
        address: this.testWallets[51]?.address,
        hasBalance: this.testWallets[51]?.hasBalance || false,
      },
    };
  }

  /**
   * Public method to get the list of disabled endpoints for transaction testing
   */
  public getDisabledEndpoints(): string[] {
    return this.configService.getTransactionTestDisabledEndpoints();
  }

  /**
   * Public method to check if a specific endpoint is disabled for testing
   * @param endpointUrl The URL to check
   */
  public isEndpointDisabled(endpointUrl: string): boolean {
    return this.isEndpointDisabledForTesting(endpointUrl);
  }

  /**
   * Check if an endpoint should be disabled for transaction testing
   * @param endpointUrl The URL of the endpoint to check
   * @returns true if the endpoint should be disabled
   */
  private isEndpointDisabledForTesting(endpointUrl: string): boolean {
    const disabledEndpoints = this.configService.getTransactionTestDisabledEndpoints();

    if (disabledEndpoints.length === 0) {
      return false;
    }

    // Check if the endpoint URL matches any of the disabled patterns
    return disabledEndpoints.some(disabledPattern => {
      // Exact URL match (most precise)
      if (endpointUrl === disabledPattern) {
        return true;
      }

      // If pattern includes protocol, match exactly
      if (disabledPattern.includes('://')) {
        // For protocol-specific patterns, only exact matches
        return endpointUrl === disabledPattern;
      }

      // If pattern is just domain/IP with port, match protocol-agnostically
      // Example: "157.173.195.189:8555" matches both "http://157.173.195.189:8555" and "https://157.173.195.189:8555"
      if (disabledPattern.includes(':') && !disabledPattern.includes('://')) {
        const urlWithoutProtocol = endpointUrl.replace(/^https?:\/\/|^wss?:\/\//, '');
        return urlWithoutProtocol === disabledPattern;
      }

      // If pattern is just domain/IP (no port), match any port for that domain
      // Example: "157.173.195.189" matches "http://157.173.195.189:8555", "ws://157.173.195.189:8556", etc.
      // But only if explicitly intended (this is a broader match)
      const urlWithoutProtocol = endpointUrl.replace(/^https?:\/\/|^wss?:\/\//, '');
      const domainFromUrl = urlWithoutProtocol.split(':')[0];

      return domainFromUrl === disabledPattern;
    });
  }

  /**
   * Filter out disabled endpoints from the provider list
   * @param providers Array of provider data to filter
   * @returns Filtered array with disabled endpoints removed
   */
  private filterEnabledProviders(providers: any[]): any[] {
    const originalCount = providers.length;
    const filteredProviders = providers.filter(providerData => {
      const isDisabled = this.isEndpointDisabledForTesting(providerData.endpoint.url);
      if (isDisabled) {
        this.logger.debug(`Skipping transaction test for disabled endpoint: ${providerData.endpoint.url}`);
      }
      return !isDisabled;
    });

    const disabledCount = originalCount - filteredProviders.length;
    if (disabledCount > 0) {
      this.logger.log(`Filtered out ${disabledCount} disabled endpoints from transaction testing`);
    }

    return filteredProviders;
  }
}
