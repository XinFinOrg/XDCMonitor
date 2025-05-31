# Transaction Monitor

## Purpose and Responsibilities

The Transaction Monitor service performs active transaction testing on XDC networks by sending real transactions and deploying test contracts. This validates network functionality beyond passive monitoring, ensuring end-to-end transaction processing capability across all endpoints. The service provides comprehensive validation of RPC endpoint transaction capabilities through dual-mode testing with intelligent failure rate analysis and optimized confirmation monitoring.

## Core Workflows

### 1. Comprehensive Wallet Management

- **Dual Network Wallet Initialization**: Maintains dedicated test wallets for each network (Mainnet chainId 50, Testnet chainId 51)
- **Private Key Validation**: Validates private key format and length (64 hex characters) with proper 0x prefix handling
- **Address Derivation**: Derives wallet addresses from private keys using ethers.js for secure address generation
- **Balance State Tracking**: Maintains real-time balance status with hasBalance flags for each wallet
- **Automatic Balance Verification**: Continuous balance monitoring with threshold-based validation (0.01 XDC minimum)

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

### 4. Optimized Transaction Lifecycle Management

- **Transaction Submission**: Submits transactions through BlockchainService with specific RPC endpoint targeting
- **Enhanced Confirmation Monitoring**: Actively monitors transaction confirmation status with optimized exponential backoff strategy
- **Receipt Validation**: Validates transaction receipts and confirms successful execution
- **Intelligent Timeout Handling**: Implements optimized timeout mechanisms with exponential backoff (1s to 10s cap)
- **Reduced Attempt Count**: Optimized to 8 maximum attempts (reduced from 10) with exponential backoff
- **Status Tracking**: Tracks transaction status from submission through final confirmation with early exit on failure

### 5. Intelligent Provider Selection and Testing

- **Active Provider Filtering**: Tests only providers that are marked as 'up' and have active connections
- **Chain-Specific Provider Selection**: Separate provider lists for Mainnet (chainId 50) and Testnet (chainId 51)
- **Provider Health Integration**: Integrates with BlockchainService provider health status for reliable endpoint selection
- **Dynamic Provider Discovery**: Automatically discovers and tests newly available providers
- **Provider-Specific Result Tracking**: Individual success/failure tracking per RPC endpoint
- **Enhanced Endpoint Filtering**: Comprehensive filtering system with disabled endpoint management

### 6. Advanced Failure Rate Analysis

- **Comprehensive Result Tracking**: Tracks success/failure rates for each transaction type per network
- **Endpoint-Specific Failure Tracking**: Maintains detailed lists of failing endpoints for troubleshooting
- **Threshold-Based Alerting**: Generates alerts when failure rates exceed 50% across RPC endpoints
- **Detailed Failure Reporting**: Provides specific endpoint lists in alert messages for rapid issue identification
- **Network-Specific Analysis**: Separate failure rate analysis for Mainnet and Testnet networks
- **Formatted Alert Messages**: Enhanced alert formatting with bulleted endpoint lists for better readability

### 7. Automated Scheduling and Execution

- **Cron-Based Scheduling**: Executes tests every 5 minutes using `@nestjs/schedule` Cron decorator (`0 */5 * * * *`)
- **Pre-Test Validation**: Forces wallet balance checks before each test cycle execution
- **Conditional Test Execution**: Skips tests when wallet balances are insufficient with clear notifications
- **Parallel Network Testing**: Simultaneous testing on both networks with independent result aggregation
- **Comprehensive Test Coverage**: Tests all available providers with both transaction types per cycle
- **Enhanced Provider Filtering**: Filters out disabled endpoints from transaction testing

### 8. Flexible Endpoint Management

- **Configuration-Based Endpoint Filtering**: Three-tier matching system for precise endpoint control
- **Runtime Endpoint Management**: Environment variable-based endpoint disable/enable without service restart
- **Exact URL Matching**: Precise endpoint matching for specific URL exclusions
- **Protocol-Agnostic Domain Matching**: Matches domain+port combinations across different protocols
- **Broad Domain Matching**: Supports domain-only patterns for comprehensive endpoint management
- **Public API Methods**: Exposed methods for getting disabled endpoints and checking endpoint status

## Configuration Options

### Core Configuration

- `enableTransactionMonitoring`: Toggle monitoring on/off via ConfigService (default: configurable)
- `mainnetTestPrivateKey`: Private key for Mainnet test wallet (loaded securely from ConfigService)
- `testnetTestPrivateKey`: Private key for Testnet test wallet (loaded securely from ConfigService)
- `TRANSACTION_TEST_DISABLED_ENDPOINTS`: Environment variable for managing disabled endpoints

### Operational Thresholds

- `MIN_BALANCE_THRESHOLD`: Minimum wallet balance required for testing (0.01 XDC)
- **Test Transaction Amount**: Uses minimal amounts (0.0001 XDC) for cost-effective testing
- **Confirmation Timeout**: Maximum 8 attempts with exponential backoff (1s to 10s cap)
- **Failure Rate Threshold**: 50% failure rate triggers high-priority alerts
- **Exponential Backoff**: Starting at 1 second, multiplying by 1.5, capped at 10 seconds

### Smart Contract Testing

- `TEST_CONTRACT_BYTECODE`: Bytecode of simple storage contract used for deployment testing
- **Contract Type**: Simple storage contract with get/set functionality for reliable testing
- **Deployment Parameters**: Empty constructor parameters for consistent deployment testing

### Alert Configuration

- `ALERTS.TYPES.TRANSACTION_FAILURE_RATE_HIGH`: Alert type for high failure rates across endpoints
- `ALERTS.TYPES.INSUFFICIENT_WALLET_BALANCE`: Alert type for low wallet balance conditions
- **Alert Components**: Uses `ALERTS.COMPONENTS.TRANSACTION` for proper alert categorization

### Endpoint Management Configuration

- **Exact URL Matching**: Full URL patterns including protocol for precise exclusions
- **Domain+Port Matching**: Protocol-agnostic matching for domain and port combinations
- **Domain-Only Matching**: Broad matching for all ports on a domain
- **Configuration Format**: Comma-separated list in TRANSACTION_TEST_DISABLED_ENDPOINTS environment variable

## Integration Points

### Service Dependencies

- **BlockchainService**:
  - Access to blockchain providers across networks with chain-specific provider retrieval
  - Transaction submission through `sendTransaction` and `deployContract` methods
  - Transaction status monitoring through `getTransaction` method with retry tracking
  - Provider health status integration for reliable endpoint selection
- **ConfigService**:
  - Loads configuration including private keys and feature toggles
  - Provides test receiver addresses through `getTestReceiverAddress` method
  - Supplies network-specific configuration parameters
  - Manages disabled endpoints through `getTransactionTestDisabledEndpoints` method
- **MetricsService**:
  - Records transaction metrics through `setTransactionMonitorResult` method
  - Reports wallet balances through `setWalletBalance` method
  - Tracks success rates, confirmation times, and gas usage metrics
- **AlertService**:
  - Sends alerts for low wallet balances through warning-level notifications
  - Handles high failure rate alerts through error-level notifications
  - Provides detailed failure information with endpoint-specific details and formatting

### External Integrations

- **InfluxDB Metrics**: Comprehensive transaction metrics storage for dashboard visualization
- **Grafana Dashboards**: Real-time transaction success rate and wallet balance monitoring
- **Telegram Alerts**: Critical alerts for transaction failures and wallet balance issues

## Scheduled Testing Architecture

### Cron-Based Execution

- **Schedule**: Every 5 minutes (`0 */5 * * * *`) using NestJS Schedule module
- **Execution Flow**: Pre-test validation → Provider discovery → Endpoint filtering → Transaction testing → Result analysis → Alert generation
- **Network Coverage**: Tests executed on both Mainnet (chainId 50) and Testnet (chainId 51)
- **Provider Coverage**: All available and healthy providers tested with both transaction types after filtering

### Test Execution Strategy

- **Sequential Provider Testing**: Tests each provider individually to isolate endpoint-specific issues
- **Dual Transaction Types**: Both value transfer and contract deployment tested per provider
- **Result Aggregation**: Comprehensive result tracking with success/failure counts per transaction type
- **Conditional Execution**: Tests only executed when wallet balances are sufficient
- **Enhanced Filtering**: Disabled endpoints are filtered out before testing begins

### Dynamic Provider Selection

- **Health-Based Filtering**: Uses only active and healthy endpoints from BlockchainService
- **Real-Time Provider Discovery**: Automatically includes newly available providers in test cycles
- **Chain-Specific Selection**: Separate provider lists maintained for each network
- **Status Integration**: Integrates with RPC monitoring service for provider health status
- **Endpoint Management**: Applies disabled endpoint filtering for precise testing control

## Error Handling and Resilience

### Comprehensive Error Management

- **Detailed Error Reporting**: Reports specific error information for transaction failures
- **Error Type Differentiation**: Distinguishes between insufficient funds, network errors, and timeout issues
- **Graceful Degradation**: Continues testing other providers when individual endpoints fail
- **Error Context Preservation**: Maintains error context for troubleshooting and alert generation

### Prerequisite Validation

- **Balance Validation**: Skips tests with clear notifications when wallet balances are insufficient
- **Provider Availability**: Validates provider availability before attempting transactions
- **Private Key Validation**: Ensures private keys are properly formatted and valid (64 hex characters)
- **Network Connectivity**: Verifies network connectivity before transaction submission

### State Management

- **Wallet State Persistence**: Maintains wallet state between test runs for consistency
- **Balance State Tracking**: Tracks balance status changes for accurate test execution decisions
- **Result State Aggregation**: Maintains comprehensive result state for failure rate analysis
- **Recovery Mechanisms**: Automatic recovery from transient failures without service restart

### Optimized Confirmation Strategy

- **Exponential Backoff**: Intelligent timing strategy starting at 1 second, multiplying by 1.5, capped at 10 seconds
- **Reduced API Calls**: Optimized retry count (8 attempts) to reduce resource usage
- **Early Exit**: Stops monitoring immediately when transaction fails
- **Smart Delays**: No delay after final attempt for faster failure detection

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
- **Optimized Performance**: Enhanced confirmation monitoring with exponential backoff for efficiency

### Comprehensive Metrics and Alerting

- **Detailed Success Rate Tracking**: Records transaction success rates, confirmation times, and gas usage
- **Endpoint-Specific Metrics**: Individual tracking per RPC endpoint for granular analysis
- **Automatic Alert Generation**: Sends notifications for transaction failures and insufficient balances
- **Failure Rate Detection**: Alerts when more than 50% of RPC endpoints fail transaction processing
- **Enhanced Alert Formatting**: Improved alert messages with bulleted endpoint lists for clarity

### Robust Design Features

- **Fail-Safe Operation**: Won't attempt transactions if wallet balance is insufficient
- **Detailed Failure Information**: Includes specific lists of failing endpoints in alert messages
- **Timeout Protection**: Prevents hanging transactions with optimized timeout mechanisms
- **Resource Optimization**: Efficient transaction testing with minimal network resource usage
- **Flexible Endpoint Management**: Configuration-driven endpoint disable/enable system

### Endpoint Management Features

- **Three-Tier Matching System**: Exact URL, domain+port, and domain-only matching patterns
- **Runtime Configuration**: Environment variable-based management without service restart
- **Public API Access**: Methods to check disabled endpoints and endpoint status
- **Comprehensive Logging**: Detailed logging of endpoint filtering and disabled endpoint counts
- **Safety Features**: Precise matching prevents accidental broad exclusions

## Transaction Testing Deep Dive

### Transaction Types and Validation

#### Normal Value Transfer Testing

- **Transaction Amount**: 0.0001 XDC for cost-effective testing
- **Receiver Address**: Configurable test receiver address per network
- **Validation Process**: Submission → Optimized confirmation monitoring → Receipt validation
- **Success Criteria**: Transaction confirmed and included in blockchain

#### Smart Contract Deployment Testing

- **Contract Type**: Simple storage contract with get/set functionality
- **Bytecode**: Pre-compiled bytecode for consistent deployment testing
- **Constructor Parameters**: Empty parameters for reliable deployment
- **Validation Process**: Deployment → Contract address verification → Execution confirmation

### Enhanced Confirmation Monitoring System

- **Optimized Polling Strategy**: Exponential backoff starting at 1 second with 1.5x multiplier
- **Maximum Attempts**: 8 attempts (reduced from 10) for improved efficiency
- **Maximum Backoff**: 10-second cap to prevent excessive delays
- **Status Validation**: Confirms `TransactionStatus.CONFIRMED` status with early exit on failure
- **Intelligent Retry Logic**: No delay after final attempt for faster failure detection

### Result Tracking and Analysis

- **Per-Network Tracking**: Separate result tracking for Mainnet and Testnet
- **Per-Type Tracking**: Individual tracking for normal transactions and contract deployments
- **Endpoint-Specific Results**: Success/failure tracking per RPC endpoint
- **Failure Rate Calculation**: Real-time calculation of failure rates with threshold-based alerting
- **Enhanced Result Aggregation**: Comprehensive tracking with detailed failure endpoint lists

### Endpoint Filtering and Management

- **Exact URL Matching**: Precise matching for specific endpoint exclusions (e.g., "https://rpc.xdcrpc.com:8545")
- **Protocol-Agnostic Matching**: Domain+port matching across protocols (e.g., "rpc.xdcrpc.com:8545")
- **Domain-Only Matching**: Broad matching for all ports on a domain (e.g., "rpc.xdcrpc.com")
- **Configuration Management**: Environment variable TRANSACTION_TEST_DISABLED_ENDPOINTS
- **Runtime Updates**: Changes take effect immediately without service restart

## Performance Optimizations

### Efficient Resource Management

- **Minimal Transaction Amounts**: Uses 0.0001 XDC to minimize testing costs
- **Targeted Provider Testing**: Tests only healthy and available providers
- **Optimized Confirmation Polling**: Exponential backoff strategy with reasonable timeouts
- **Resource Cleanup**: Proper cleanup of transaction resources and connections

### Testing Efficiency

- **Parallel Network Testing**: Simultaneous testing on multiple networks
- **Conditional Execution**: Skips unnecessary tests when prerequisites aren't met
- **Provider Health Integration**: Leverages existing health monitoring for efficient provider selection
- **Result Caching**: Maintains result state for efficient failure rate analysis
- **Enhanced Confirmation Strategy**: Reduced API calls with intelligent backoff timing

### Confirmation Monitoring Optimizations

- **Exponential Backoff**: 1s → 1.5s → 2.25s → 3.375s → 5.06s → 7.59s → 10s → 10s pattern
- **Reduced Attempt Count**: Optimized to 8 attempts for faster failure detection
- **Early Exit Strategy**: Immediate termination on confirmed failure status
- **Capped Backoff**: 10-second maximum delay prevents excessive wait times
- **Smart Resource Usage**: Reduced async hooks and API calls for better performance

## API and Status Access

### Public Methods

- `getTestWalletStatus()`: Returns current test wallet status for both networks including:
  - Wallet addresses for Mainnet and Testnet
  - Balance status (hasBalance) for each wallet
  - Real-time balance validation status
- `getDisabledEndpoints()`: Returns array of currently disabled endpoint patterns
- `isEndpointDisabled(endpointUrl)`: Checks if a specific endpoint is disabled for testing

### Status Information

- **Wallet Status**: Address and balance status for each network
- **Test Results**: Success/failure rates per transaction type and network
- **Provider Coverage**: List of tested providers and their individual results
- **Alert History**: Recent alerts for failures and balance issues
- **Endpoint Management**: Current disabled endpoint patterns and filtering status

### Endpoint Management API

- **Disabled Endpoint Listing**: Public method to retrieve current disabled endpoint patterns
- **Endpoint Status Checking**: Method to verify if specific endpoints are disabled
- **Filtering Logic Inspection**: Access to three-tier matching logic for debugging
- **Configuration Validation**: Runtime validation of endpoint filtering patterns

## Testing and Debugging

### Comprehensive Logging

- **Debug Level Logging**: Detailed operation logging for transaction testing activities
- **Performance Metrics**: Built-in timing and success rate tracking
- **Error Context**: Rich error information with transaction and endpoint details
- **Result Summaries**: Comprehensive logging of test results per cycle
- **Endpoint Filtering Logs**: Detailed logging of disabled endpoint filtering

### Monitoring Health

- **Wallet Balance Monitoring**: Real-time wallet balance tracking and alerting
- **Transaction Success Rates**: Quantitative success rate assessment per endpoint
- **Provider Coverage Analysis**: Tracking of provider availability and test coverage
- **Alert Frequency Monitoring**: Monitoring of alert patterns for optimization
- **Endpoint Management Tracking**: Monitoring of disabled endpoint patterns and usage

### Troubleshooting Tools

- **Endpoint-Specific Results**: Individual success/failure tracking per RPC endpoint
- **Transaction Type Analysis**: Separate analysis for normal transactions vs contract deployments
- **Network-Specific Debugging**: Independent analysis for Mainnet and Testnet networks
- **Failure Context Preservation**: Detailed failure information for rapid issue resolution
- **Endpoint Filtering Debugging**: Tools to verify and debug endpoint filtering logic

### Enhanced Debugging Features

- **Confirmation Monitoring Logs**: Detailed logs of exponential backoff attempts and timing
- **Provider Selection Logs**: Tracking of provider filtering and selection process
- **Balance Validation Logs**: Detailed wallet balance checking and validation logging
- **Endpoint Management Logs**: Comprehensive logging of endpoint filtering decisions
