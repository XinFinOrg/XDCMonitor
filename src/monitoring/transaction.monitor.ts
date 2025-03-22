import { BlockchainService } from '@blockchain/blockchain.service';
import { ConfigService } from '@config/config.service';
import { MetricsService } from '@metrics/metrics.service';
import { TransactionStatus } from '@types';
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { ethers } from 'ethers';

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
  ) {}

  async onModuleInit() {
    if (this.configService.enableTransactionMonitoring) {
      this.logger.log('Transaction monitor initialized');
      await this.initializeTestWallets();
    }
  }

  private async initializeTestWallets() {
    // Initialize test wallets with private keys from config for different networks
    // These should be test accounts with some XDC balance
    this.testWallets = {
      '50': {
        privateKey: this.configService.mainnetTestPrivateKey,
        address: this.getAddressFromPrivateKey(this.configService.mainnetTestPrivateKey),
        hasBalance: false,
      },
      '51': {
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
    await this.checkWalletBalance('50');

    // Check testnet wallet balance
    await this.checkWalletBalance('51');
  }

  /**
   * Check balance of a specific wallet
   */
  private async checkWalletBalance(chainId: string) {
    const wallet = this.testWallets[chainId];
    if (!wallet || !wallet.address) {
      this.logger.warn(`No valid test wallet found for chainId ${chainId}`);
      return;
    }

    const chainName = chainId === '50' ? 'Mainnet' : 'Testnet';

    try {
      // Get a provider for this chain
      const providerData = this.blockchainService.getProviderForChainId(parseInt(chainId, 10));
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

    // Test each active mainnet RPC with both transaction types if wallet has enough balance
    if (this.testWallets['50'].hasBalance) {
      for (const providerData of mainnetProviders) {
        // Run normal transaction test
        await this.runTransactionTest('50', false, providerData.endpoint.url);
        // Run contract deployment test
        await this.runTransactionTest('50', true, providerData.endpoint.url);
      }
    } else {
      this.logger.warn('Skipping Mainnet transaction tests due to insufficient wallet balance');
      // TODO: Send alert and notification
    }

    // Test each active testnet RPC with both transaction types if wallet has enough balance
    if (this.testWallets['51'].hasBalance) {
      for (const providerData of testnetProviders) {
        // Run normal transaction test
        await this.runTransactionTest('51', false, providerData.endpoint.url);
        // Run contract deployment test
        await this.runTransactionTest('51', true, providerData.endpoint.url);
      }
    } else {
      this.logger.warn('Skipping Testnet transaction tests due to insufficient wallet balance');
      // TODO: Send alert and notification
    }
  }

  private async runTransactionTest(chainId: string, deployContract: boolean, rpcUrl?: string) {
    const chainName = chainId === '50' ? 'Mainnet' : 'Testnet';
    const startTime = Date.now();
    let success = false;
    let txHash = '';
    let gasUsed = 0;

    // Get the RPC name for metrics and logs
    let rpcName = 'Primary';
    if (rpcUrl) {
      const provider = this.blockchainService.getAllProviders().find(p => p.endpoint.url === rpcUrl);
      if (provider) {
        rpcName = provider.endpoint.name;
      }
    }

    try {
      // Double check wallet has balance (in case it was drained during testing)
      if (!this.testWallets[chainId].hasBalance) {
        throw new Error(`Insufficient balance in ${chainName} test wallet`);
      }

      if (deployContract) {
        // Deploy test contract
        this.logger.debug(`Deploying test contract on ${chainName} ${rpcName} (chainId: ${chainId})`);

        const result = await this.blockchainService.deployContract(
          this.testWallets[chainId].privateKey,
          this.TEST_CONTRACT_BYTECODE,
          [],
          chainId,
          rpcUrl,
        );

        txHash = result.transactionHash;
        gasUsed = result.gasUsed;
      } else {
        // Send normal test transaction
        this.logger.debug(`Sending normal test transaction on ${chainName} ${rpcName} (chainId: ${chainId})`);

        // Get a receiving address (could be another test wallet)
        const receiverAddress = this.configService.getTestReceiverAddress(chainId);

        const result = await this.blockchainService.sendTransaction(
          this.testWallets[chainId].privateKey,
          receiverAddress,
          '0.0001', // Small test amount
          chainId,
          rpcUrl,
        );

        txHash = result.transactionHash;
        gasUsed = result.gasUsed;
      }

      // Wait for transaction confirmation
      let txConfirmed = false;
      let attempts = 0;
      const maxAttempts = 10;

      while (!txConfirmed && attempts < maxAttempts) {
        const tx = await this.blockchainService.getTransaction(txHash);
        if (tx && tx.status === TransactionStatus.CONFIRMED) {
          txConfirmed = true;
        } else {
          await new Promise(resolve => setTimeout(resolve, 2000)); // Wait 2 seconds
          attempts++;
        }
      }

      success = txConfirmed;
      const duration = Date.now() - startTime;

      // Record metrics
      this.metricsService.setTransactionMonitorResult(
        deployContract ? 'contract_deployment' : 'normal_transaction',
        success,
        duration,
        gasUsed,
        chainId,
        rpcName,
      );

      this.logger.log(
        `Transaction test ${success ? 'successful' : 'failed'} on ${chainName} ${rpcName}: ` +
          `Type: ${deployContract ? 'Contract Deployment' : 'Normal Transaction'}, ` +
          `Duration: ${duration}ms, Gas Used: ${gasUsed}`,
      );
    } catch (error) {
      this.logger.error(
        `Transaction test failed on ${chainName} ${rpcName}: ` +
          `Type: ${deployContract ? 'Contract Deployment' : 'Normal Transaction'}, ` +
          `Error: ${error.message}`,
      );

      // Record failure metric
      this.metricsService.setTransactionMonitorResult(
        deployContract ? 'contract_deployment' : 'normal_transaction',
        false,
        Date.now() - startTime,
        0,
        chainId,
        rpcName,
      );
    }
  }
}
