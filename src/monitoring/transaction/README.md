# Transaction Monitor

## Purpose and Responsibilities

The Transaction Monitor service performs active transaction testing on XDC networks by sending real transactions and deploying test contracts. This validates network functionality beyond passive monitoring, ensuring end-to-end transaction processing capability across all endpoints.

## Core Workflows

1. **Wallet Management**: Maintains dedicated test wallets for each network (Mainnet chainId 50, Testnet chainId 51)
2. **Balance Monitoring**: Checks test wallet balances to ensure sufficient funds for test transactions
3. **Simple Value Transfers**: Executes small XDC transfers between test accounts
4. **Smart Contract Deployment**: Deploys a simple storage contract to test contract creation functionality
5. **Transaction Lifecycle**: Tracks transaction submission, confirmation, and receipt validation
6. **Provider Testing**: Tests transaction functionality across all available RPC endpoints

## Configuration Options

- `enableTransactionMonitoring`: Toggle monitoring on/off via ConfigService
- `mainnetTestPrivateKey`: Private key for Mainnet test wallet (loaded from ConfigService)
- `testnetTestPrivateKey`: Private key for Testnet test wallet (loaded from ConfigService)
- `MIN_BALANCE_THRESHOLD`: Minimum wallet balance required for testing (0.01 XDC)
- `TEST_CONTRACT_BYTECODE`: Bytecode of simple storage contract used for testing

## Integration Points

- **BlockchainService**: Access to blockchain providers across networks and retrieval of providers by chainId
- **ConfigService**: Loads configuration including private keys and feature toggles
- **MetricsService**: Reports transaction metrics and wallet balances
- **AlertService**: Sends alerts on low wallet balances or transaction failures

## Scheduled Testing

- Uses `@nestjs/schedule` Cron decorator to run tests every 5 minutes
- Tests are executed on both Mainnet (chainId 50) and Testnet (chainId 51)
- For each available provider, both transaction types (value transfer and contract deployment) are tested
- Status changes and metrics are updated after each test cycle

## Error Handling

- Reports detailed error information for transaction failures
- Differentiates between various failure types (insufficient funds, network errors, etc.)
- Skips tests with clear error notifications when prerequisite conditions aren't met
- Maintains wallet state between test runs
