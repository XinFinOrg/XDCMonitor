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
7. **Multi-endpoint Validation**: Verifies transaction compatibility across different RPC endpoints on the same network
8. **Failure Rate Monitoring**: Tracks transaction failure rates across RPC endpoints and generates alerts when more than 50% of endpoints fail

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
- **ALERTS.TYPES.TRANSACTION_FAILURE_RATE_HIGH**: Alert type used when transaction failure rate exceeds 50%

## Scheduled Testing

- Uses `@nestjs/schedule` Cron decorator to run tests every 5 minutes (`0 */5 * * * *`)
- Tests are executed on both Mainnet (chainId 50) and Testnet (chainId 51)
- For each available provider, both transaction types (value transfer and contract deployment) are tested
- Status changes and metrics are updated after each test cycle
- Dynamic provider selection uses only active and healthy endpoints
- Tracks transaction success/failure rates and generates alerts when failure rates exceed 50%
- Detailed failure information includes a list of all failing RPC endpoints

## Error Handling

- Reports detailed error information for transaction failures
- Differentiates between various failure types (insufficient funds, network errors, etc.)
- Skips tests with clear error notifications when prerequisite conditions aren't met
- Maintains wallet state between test runs
- Automatic alerts for insufficient wallet balances
- Aggregated failure rate tracking with specific endpoint details for troubleshooting

## Key Features

- **Active Transaction Testing**: Tests real transaction workflows rather than just passive monitoring
- **Dual Network Support**: Parallel testing on both Mainnet and Testnet networks
- **Multiple Transaction Types**: Tests both simple value transfers and contract deployments
- **Multi-endpoint Validation**: Tests all active RPC endpoints on each network
- **Wallet Balance Monitoring**: Tracks test wallet balances with alerts for low funds
- **Efficient Transaction Amount**: Uses minimal amounts (0.0001 XDC) for cost-effective testing
- **Comprehensive Metrics**: Records transaction success rates, confirmation times, and gas usage
- **Automatic Alerts**: Sends notifications for transaction failures and insufficient balances
- **Fail-safe Design**: Won't attempt transactions if wallet balance is too low
- **Failure Rate Detection**: Alerts when more than 50% of RPC endpoints fail transaction processing
- **Detailed Failure Information**: Includes specific list of failing endpoints in alert messages
