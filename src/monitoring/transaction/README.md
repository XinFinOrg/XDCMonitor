# Transaction Monitor

## Purpose and Responsibilities

The Transaction Monitor service performs active transaction testing on XDC networks by sending real transactions and deploying test contracts. This validates network functionality beyond passive monitoring, ensuring end-to-end transaction processing capability across all endpoints. The service provides comprehensive validation of RPC endpoint transaction capabilities through dual-mode testing with intelligent failure rate analysis.

## Core Workflows

### 1. Comprehensive Wallet Management

- **Dual Network Wallet Initialization**: Maintains dedicated test wallets for each network (Mainnet chainId 50, Testnet chainId 51)
- **Private Key Validation**: Validates private key format and length (64 hex characters) with proper 0x prefix handling
- **Address Derivation**: Derives wallet addresses from private keys using ethers.js for secure address generation
- **Balance State Tracking**: Maintains real-time balance status with hasBalance flags for each wallet
- **Automatic Balance Verification**: Continuous balance monitoring with threshold-based validation

### 2. Advanced Balance Monitoring

- **Real-Time Balance Checking**: Checks test wallet balances before each test cycle to ensure sufficient funds
- **Multi-Provider Balance Validation**: Uses available providers for each chain to retrieve accurate balance information
- **Threshold-Based Validation**: Ensures wallets maintain minimum 0.01 XDC balance for reliable testing
- **Balance Metrics Recording**: Records wallet balances and status in MetricsService for dashboard visibility
- **Insufficient Balance Alerting**: Automatic alerts when wallet balances fall below operational thresholds

### 3. Dual-Mode Transaction Testing

- **Simple Value Transfers**: Executes small XDC transfers (0.0001 XDC) between test accounts for basic functionality validation
- **Smart Contract Deployment**: Deploys simple storage contracts to test contract creation and execution functionality
- **Multi-Endpoint Validation**: Tests transaction functionality across all available and healthy RPC endpoints
- **Transaction Type Differentiation**: Separate tracking and metrics for normal transactions vs contract deployments
- **Cross-Network Testing**: Parallel testing on both Mainnet and Testnet networks with independent result tracking

### 4. Comprehensive Transaction Lifecycle Management

- **Transaction Submission**: Submits transactions through BlockchainService with specific RPC endpoint targeting
- **Confirmation Monitoring**: Actively monitors transaction confirmation status with configurable retry attempts (max 10)
- **Receipt Validation**: Validates transaction receipts and confirms successful execution
- **Timeout Handling**: Implements timeout mechanisms with 2-second intervals between confirmation checks
- **Status Tracking**: Tracks transaction status from submission through final confirmation

### 5. Intelligent Provider Selection and Testing

- **Active Provider Filtering**: Tests only providers that are marked as 'up' and have active connections
- **Chain-Specific Provider Selection**: Separate provider lists for Mainnet (chainId 50) and Testnet (chainId 51)
- **Provider Health Integration**: Integrates with BlockchainService provider health status for reliable endpoint selection
- **Dynamic Provider Discovery**: Automatically discovers and tests newly available providers
- **Provider-Specific Result Tracking**: Individual success/failure tracking per RPC endpoint

### 6. Advanced Failure Rate Analysis

- **Comprehensive Result Tracking**: Tracks success/failure rates for each transaction type per network
- **Endpoint-Specific Failure Tracking**: Maintains detailed lists of failing endpoints for troubleshooting
- **Threshold-Based Alerting**: Generates alerts when failure rates exceed 50% across RPC endpoints
- **Detailed Failure Reporting**: Provides specific endpoint lists in alert messages for rapid issue identification
- **Network-Specific Analysis**: Separate failure rate analysis for Mainnet and Testnet networks

### 7. Automated Scheduling and Execution

- **Cron-Based Scheduling**: Executes tests every 5 minutes using `@nestjs/schedule` Cron decorator (`0 */5 * * * *`)
- **Pre-Test Validation**: Forces wallet balance checks before each test cycle execution
- **Conditional Test Execution**: Skips tests when wallet balances are insufficient with clear notifications
- **Parallel Network Testing**: Simultaneous testing on both networks with independent result aggregation
- **Comprehensive Test Coverage**: Tests all available providers with both transaction types per cycle

## Configuration Options

### Core Configuration

- `enableTransactionMonitoring`: Toggle monitoring on/off via ConfigService (default: configurable)
- `mainnetTestPrivateKey`: Private key for Mainnet test wallet (loaded securely from ConfigService)
- `testnetTestPrivateKey`: Private key for Testnet test wallet (loaded securely from ConfigService)

### Operational Thresholds

- `MIN_BALANCE_THRESHOLD`: Minimum wallet balance required for testing (0.01 XDC)
- **Test Transaction Amount**: Uses minimal amounts (0.0001 XDC) for cost-effective testing
- **Confirmation Timeout**: Maximum 10 attempts with 2-second intervals (20 seconds total)
- **Failure Rate Threshold**: 50% failure rate triggers high-priority alerts

### Smart Contract Testing

- `TEST_CONTRACT_BYTECODE`: Bytecode of simple storage contract used for deployment testing
- **Contract Type**: Simple storage contract with get/set functionality for reliable testing
- **Deployment Parameters**: Empty constructor parameters for consistent deployment testing

### Alert Configuration

- `ALERTS.TYPES.TRANSACTION_FAILURE_RATE_HIGH`: Alert type for high failure rates across endpoints
- `ALERTS.TYPES.INSUFFICIENT_WALLET_BALANCE`: Alert type for low wallet balance conditions
- **Alert Components**: Uses `ALERTS.COMPONENTS.TRANSACTION` for proper alert categorization

## Integration Points

### Service Dependencies

- **BlockchainService**:
  - Access to blockchain providers across networks with chain-specific provider retrieval
  - Transaction submission through `sendTransaction` and `deployContract` methods
  - Transaction status monitoring through `getTransaction` method
  - Provider health status integration for reliable endpoint selection
- **ConfigService**:
  - Loads configuration including private keys and feature toggles
  - Provides test receiver addresses through `getTestReceiverAddress` method
  - Supplies network-specific configuration parameters
- **MetricsService**:
  - Records transaction metrics through `setTransactionMonitorResult` method
  - Reports wallet balances through `setWalletBalance` method
  - Tracks success rates, confirmation times, and gas usage metrics
- **AlertService**:
  - Sends alerts for low wallet balances through warning-level notifications
  - Handles high failure rate alerts through error-level notifications
  - Provides detailed failure information with endpoint-specific details

### External Integrations

- **InfluxDB Metrics**: Comprehensive transaction metrics storage for dashboard visualization
- **Grafana Dashboards**: Real-time transaction success rate and wallet balance monitoring
- **Telegram Alerts**: Critical alerts for transaction failures and wallet balance issues

## Scheduled Testing Architecture

### Cron-Based Execution

- **Schedule**: Every 5 minutes (`0 */5 * * * *`) using NestJS Schedule module
- **Execution Flow**: Pre-test validation → Provider discovery → Transaction testing → Result analysis → Alert generation
- **Network Coverage**: Tests executed on both Mainnet (chainId 50) and Testnet (chainId 51)
- **Provider Coverage**: All available and healthy providers tested with both transaction types

### Test Execution Strategy

- **Sequential Provider Testing**: Tests each provider individually to isolate endpoint-specific issues
- **Dual Transaction Types**: Both value transfer and contract deployment tested per provider
- **Result Aggregation**: Comprehensive result tracking with success/failure counts per transaction type
- **Conditional Execution**: Tests only executed when wallet balances are sufficient

### Dynamic Provider Selection

- **Health-Based Filtering**: Uses only active and healthy endpoints from BlockchainService
- **Real-Time Provider Discovery**: Automatically includes newly available providers in test cycles
- **Chain-Specific Selection**: Separate provider lists maintained for each network
- **Status Integration**: Integrates with RPC monitoring service for provider health status

## Error Handling and Resilience

### Comprehensive Error Management

- **Detailed Error Reporting**: Reports specific error information for transaction failures
- **Error Type Differentiation**: Distinguishes between insufficient funds, network errors, and timeout issues
- **Graceful Degradation**: Continues testing other providers when individual endpoints fail
- **Error Context Preservation**: Maintains error context for troubleshooting and alert generation

### Prerequisite Validation

- **Balance Validation**: Skips tests with clear notifications when wallet balances are insufficient
- **Provider Availability**: Validates provider availability before attempting transactions
- **Private Key Validation**: Ensures private keys are properly formatted and valid
- **Network Connectivity**: Verifies network connectivity before transaction submission

### State Management

- **Wallet State Persistence**: Maintains wallet state between test runs for consistency
- **Balance State Tracking**: Tracks balance status changes for accurate test execution decisions
- **Result State Aggregation**: Maintains comprehensive result state for failure rate analysis
- **Recovery Mechanisms**: Automatic recovery from transient failures without service restart

## Key Features and Capabilities

### Active Transaction Validation

- **Real Transaction Testing**: Tests actual transaction workflows rather than passive monitoring
- **End-to-End Validation**: Validates complete transaction lifecycle from submission to confirmation
- **Multi-Type Testing**: Comprehensive testing of both value transfers and contract deployments
- **Cross-Endpoint Validation**: Tests transaction compatibility across different RPC endpoints

### Advanced Monitoring Features

- **Dual Network Support**: Parallel testing on both Mainnet and Testnet networks with independent tracking
- **Multi-Endpoint Validation**: Tests all active RPC endpoints on each network for comprehensive coverage
- **Intelligent Wallet Management**: Automated wallet balance monitoring with threshold-based validation
- **Cost-Effective Testing**: Uses minimal transaction amounts (0.0001 XDC) for sustainable testing

### Comprehensive Metrics and Alerting

- **Detailed Success Rate Tracking**: Records transaction success rates, confirmation times, and gas usage
- **Endpoint-Specific Metrics**: Individual tracking per RPC endpoint for granular analysis
- **Automatic Alert Generation**: Sends notifications for transaction failures and insufficient balances
- **Failure Rate Detection**: Alerts when more than 50% of RPC endpoints fail transaction processing

### Robust Design Features

- **Fail-Safe Operation**: Won't attempt transactions if wallet balance is insufficient
- **Detailed Failure Information**: Includes specific lists of failing endpoints in alert messages
- **Timeout Protection**: Prevents hanging transactions with configurable timeout mechanisms
- **Resource Optimization**: Efficient transaction testing with minimal network resource usage

## Transaction Testing Deep Dive

### Transaction Types and Validation

#### Normal Value Transfer Testing

- **Transaction Amount**: 0.0001 XDC for cost-effective testing
- **Receiver Address**: Configurable test receiver address per network
- **Validation Process**: Submission → Confirmation monitoring → Receipt validation
- **Success Criteria**: Transaction confirmed and included in blockchain

#### Smart Contract Deployment Testing

- **Contract Type**: Simple storage contract with get/set functionality
- **Bytecode**: Pre-compiled bytecode for consistent deployment testing
- **Constructor Parameters**: Empty parameters for reliable deployment
- **Validation Process**: Deployment → Contract address verification → Execution confirmation

### Confirmation Monitoring System

- **Polling Strategy**: 2-second intervals between confirmation checks
- **Maximum Attempts**: 10 attempts (20 seconds total timeout)
- **Status Validation**: Confirms `TransactionStatus.CONFIRMED` status
- **Retry Logic**: Automatic retry with exponential backoff for transient failures

### Result Tracking and Analysis

- **Per-Network Tracking**: Separate result tracking for Mainnet and Testnet
- **Per-Type Tracking**: Individual tracking for normal transactions and contract deployments
- **Endpoint-Specific Results**: Success/failure tracking per RPC endpoint
- **Failure Rate Calculation**: Real-time calculation of failure rates with threshold-based alerting

## Performance Optimizations

### Efficient Resource Management

- **Minimal Transaction Amounts**: Uses 0.0001 XDC to minimize testing costs
- **Targeted Provider Testing**: Tests only healthy and available providers
- **Optimized Confirmation Polling**: Efficient polling strategy with reasonable timeouts
- **Resource Cleanup**: Proper cleanup of transaction resources and connections

### Testing Efficiency

- **Parallel Network Testing**: Simultaneous testing on multiple networks
- **Conditional Execution**: Skips unnecessary tests when prerequisites aren't met
- **Provider Health Integration**: Leverages existing health monitoring for efficient provider selection
- **Result Caching**: Maintains result state for efficient failure rate analysis

## API and Status Access

### Public Methods

- `getTestWalletStatus()`: Returns current test wallet status for both networks including:
  - Wallet addresses for Mainnet and Testnet
  - Balance status (hasBalance) for each wallet
  - Real-time balance validation status

### Status Information

- **Wallet Status**: Address and balance status for each network
- **Test Results**: Success/failure rates per transaction type and network
- **Provider Coverage**: List of tested providers and their individual results
- **Alert History**: Recent alerts for failures and balance issues

## Testing and Debugging

### Comprehensive Logging

- **Debug Level Logging**: Detailed operation logging for transaction testing activities
- **Performance Metrics**: Built-in timing and success rate tracking
- **Error Context**: Rich error information with transaction and endpoint details
- **Result Summaries**: Comprehensive logging of test results per cycle

### Monitoring Health

- **Wallet Balance Monitoring**: Real-time wallet balance tracking and alerting
- **Transaction Success Rates**: Quantitative success rate assessment per endpoint
- **Provider Coverage Analysis**: Tracking of provider availability and test coverage
- **Alert Frequency Monitoring**: Monitoring of alert patterns for optimization

### Troubleshooting Tools

- **Endpoint-Specific Results**: Individual success/failure tracking per RPC endpoint
- **Transaction Type Analysis**: Separate analysis for normal transactions vs contract deployments
- **Network-Specific Debugging**: Independent analysis for Mainnet and Testnet networks
- **Failure Context Preservation**: Detailed failure information for rapid issue resolution
