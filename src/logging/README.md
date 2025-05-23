# XDC Monitor Logging System

This directory contains the comprehensive logging system for the XDC Monitor application. This guide covers everything you need to know about using, configuring, and maintaining the logging system.

## Quick Start

### 1. **Running with Logging**

```bash
# Start in development mode with info logging (default)
npm run start:dev

# Start with debug logging (more detailed)
LOG_LEVEL=debug npm run start:dev

# Start in production mode
npm run start:prod
```

### 2. **Viewing Logs**

```bash
# View all logs in real-time
npm run logs:view

# View only errors
npm run logs:view-errors

# View debug information (when debug mode is enabled)
npm run logs:view-debug
```

## Module Structure

```
src/logging/
├── logger.service.ts    # Winston-based logging service
├── logger.module.ts     # NestJS module configuration
├── index.ts            # Exports for easier importing
└── README.md           # This comprehensive documentation
```

### Files Overview

#### `logger.service.ts`

- **CustomLoggerService**: Main logging service using Winston
- **CustomLoggerOptions**: Configuration interface
- Features automatic file rotation, multiple transports, and specialized logging methods

#### `logger.module.ts`

- **LoggerModule**: NestJS global module
- Exports CustomLoggerService for dependency injection
- Imports ConfigModule for configuration access

#### `index.ts`

- Convenient exports for easier importing
- Use: `import { CustomLoggerService, LoggerModule } from '@logging';`

## Using the Logger in Your Code

### 1. **Import the Service**

```typescript
import { CustomLoggerService } from '@logging/logger.service';
// or
import { CustomLoggerService } from '@logging';
```

### 2. **Inject in Services**

```typescript
import { Injectable } from '@nestjs/common';
import { CustomLoggerService } from '@logging/logger.service';

@Injectable()
export class YourService {
  constructor(private readonly logger: CustomLoggerService) {}

  yourMethod() {
    this.logger.log('This is an info message', 'YourService');
    this.logger.warn('This is a warning', 'YourService');
    this.logger.error('This is an error', undefined, 'YourService');
    this.logger.debug('This is debug info', 'YourService');
  }
}
```

### 3. **Import the Module**

```typescript
import { LoggerModule } from '@logging/logger.module';
// or
import { LoggerModule } from '@logging';

@Module({
  imports: [LoggerModule],
})
export class YourModule {}
```

## Logging Methods

### Standard Methods

- `log()` - General information
- `error()` - Error messages with stack traces
- `warn()` - Warning messages
- `debug()` - Debug information (only when LOG_LEVEL=debug)
- `verbose()` - Verbose details

### Specialized Methods

```typescript
// Log RPC activity with latency
this.logger.logRpcActivity('https://rpc.xinfin.network', 'Connection successful', 250);

// Log blockchain activity with metadata
this.logger.logBlockchainActivity(50, 'New block processed', { blockNumber: 12345, txCount: 45 });

// Log monitoring activity
this.logger.logMonitoringActivity('RPC_MONITOR', 'Health check completed', { endpointsUp: 7, endpointsDown: 0 });

// Log metrics activity
this.logger.logMetrics('InfluxDB write completed', { pointsWritten: 100, duration: '50ms' });

// Log alert activity
this.logger.logAlert('error', 'RPC_MONITOR', 'Endpoint is down', { endpoint: 'https://rpc.example.com' });
```

### Traditional Logging Methods

```typescript
// Standard log levels
this.logger.log('General information');
this.logger.warn('Warning message');
this.logger.error('Error occurred', 'Optional stack trace');
this.logger.debug('Debug information');
this.logger.verbose('Verbose details');
```

## Log Organization

Logs are organized by **daily folders** instead of file rotation, providing better investigation capabilities:

- **Daily Folders**: Each day gets its own folder (YYYY-MM-DD format)
- **Unlimited Size**: No file size limits - logs grow as needed for investigation
- **Natural Cleanup**: Delete entire day folders when old logs are no longer needed
- **Easy Navigation**: Find logs by date when investigating specific issues

**Storage**: Each day's logs can grow unlimited (perfect for high-capacity servers prioritizing investigation over storage optimization)

### Daily Folder Structure

```
logs/
├── 2024-01-15/           # Daily folder (YYYY-MM-DD format)
│   ├── combined.log      # All log levels for this day
│   ├── app.log           # Application logs for this day
│   ├── error.log         # Error logs for this day
│   ├── debug.log         # Debug logs (when LOG_LEVEL=debug)
│   ├── exceptions.log    # Uncaught exceptions
│   └── rejections.log    # Promise rejections
├── 2024-01-16/           # Next day's logs
│   ├── combined.log
│   ├── app.log
│   └── error.log
└── archive/              # Archived logs (manual)
    └── 20240115_143022/  # Archived timestamp folder
```

### Benefits of Daily Organization

✅ **Easy Investigation** - Go directly to the day when an issue occurred  
✅ **Natural Cleanup** - Delete entire day folders when no longer needed  
✅ **Better Performance** - Smaller files per day instead of huge rotating files  
✅ **Unlimited Storage** - No file size limits, perfect for high-capacity servers  
✅ **Intuitive Navigation** - Organized the way humans think about time

## Scripts for Log Management

### Viewing Today's Logs

```bash
# View all today's logs (use yarn or npm)
yarn logs:view              # All today's log files
yarn logs:view-errors       # Today's error logs only
yarn logs:view-app         # Today's app logs only
yarn logs:view-debug       # Today's debug logs only
yarn logs:view-combined    # Today's combined logs only

# NPM equivalent (if you prefer npm)
npm run logs:view-errors
```

### Viewing Specific Days

```bash
# View yesterday's logs
yarn logs:view-yesterday

# List all available log days
yarn logs:list-days

# View specific day (replace YYYY-MM-DD with actual date)
tail -f logs/2024-01-15/*.log

# Example: View January 15th logs
tail -f logs/2024-01-15/error.log
```

### Managing Logs

```bash
# Check total log size and daily breakdown
yarn logs:size

# Archive all daily logs (moves to archive folder)
yarn logs:archive

# Clear all daily logs (permanent deletion)
yarn logs:clear

# Clean up logs older than 30 days (automatic cleanup)
yarn logs:cleanup-old
```

## Configuration

### Log Levels

Set environment variable `LOG_LEVEL` to control logging:

```bash
# In .env file or environment
LOG_LEVEL=info    # Default: info, warn, error
LOG_LEVEL=debug   # All levels including debug (creates debug.log)
LOG_LEVEL=error   # Only errors
LOG_LEVEL=warn    # Warnings and errors
LOG_LEVEL=verbose # Everything (most detailed)
```

### Environment Variables

```bash
# Set log level
LOG_LEVEL=debug

# The logger automatically:
# - Creates logs/ directory if it doesn't exist
# - Rotates files when they get too large
# - Handles exceptions and promise rejections
# - Formats logs consistently
```

## Log Format

Each log entry includes:

- **Timestamp**: YYYY-MM-DD HH:mm:ss.SSS format
- **Log Level**: ERROR, WARN, INFO, DEBUG, VERBOSE
- **Context**: Service or component name (e.g., [RpcMonitorService])
- **Message**: The actual log message
- **Metadata**: Additional JSON data when available
- **Stack traces**: For errors and exceptions

Example format:

```
2024-03-06 09:15:23.456 [INFO] [ServiceName] Your log message {"metadata": "if any"}
```

Example log entries:

```
2024-03-06 09:15:23.456 [INFO] [RpcMonitorService] Starting RPC monitoring with interval of 30s
2024-03-06 09:15:24.123 [DEBUG] [RpcMonitorService] Checking RPC endpoint: XDC Mainnet Primary (https://rpc.xinfin.network)
2024-03-06 09:15:24.789 [ERROR] [BlockchainService] WebSocket connection error for wss://ws.xinfin.network: Unexpected server response: 200
```

## Log Rotation

Logs are automatically rotated to manage storage efficiently while retaining extensive history for investigation:

- **Combined/App logs**: 500MB per file, keeps 50 files (~25GB total)
- **Error logs**: 100MB per file, keeps 30 files (~3GB total)
- **Debug logs**: 1GB per file, keeps 30 files (~30GB total)
- **Exception/Rejection logs**: 50MB per file, keeps 20 files (~1GB total each)
- **Automatic cleanup**: Old log files are automatically removed when limits are exceeded

**Total estimated storage**: ~60GB+ for comprehensive log retention, optimized for high-capacity servers that prioritize investigation capability over storage constraints.

## Monitoring Specific Logs

The application provides specialized logging for different components:

### RPC Monitoring

- Endpoint health checks
- Latency measurements
- Connection failures
- Sync status updates

### Blockchain Operations

- Block processing
- Transaction monitoring
- Network status changes
- Consensus monitoring

### Alerts and Notifications

- Alert generation
- Notification delivery
- Telegram messaging
- Webhook calls

### Metrics Collection

- InfluxDB operations
- Data point writing
- Connection status
- Performance metrics

## Log Analysis

### Common Log Analysis Commands

```bash
# Find all errors in the last hour
grep "$(date -d '1 hour ago' '+%Y-%m-%d %H:')" logs/error.log

# Check RPC endpoint issues
grep -i "rpc.*error\|endpoint.*down" logs/combined.log

# Monitor alert activity
grep "\[ALERT:" logs/combined.log | tail -20

# Check application startup
grep "XDC MONITOR APPLICATION STARTED" logs/combined.log
```

### Health Issues

```bash
grep -i "error\|fail\|down" logs/combined.log
```

### Performance Issues

```bash
grep -i "latency\|slow\|timeout" logs/combined.log
```

### RPC Issues

```bash
grep -i "rpc.*error\|endpoint.*down" logs/combined.log
```

### Alert Activity

```bash
grep -i "\[ALERT:" logs/combined.log
```

## Best Practices

### 1. **Use Appropriate Log Levels**

```typescript
// ✅ Good
this.logger.debug('Starting endpoint health check'); // Debug details
this.logger.log('RPC endpoint is healthy'); // General info
this.logger.warn('Endpoint responding slowly'); // Potential issues
this.logger.error('Endpoint connection failed'); // Actual errors

// ❌ Avoid
this.logger.log('Debug: checking endpoint...'); // Use debug() instead
this.logger.error('Endpoint is slow'); // Use warn() instead
```

### 2. **Include Context**

```typescript
// ✅ Good
this.logger.log('Connection established', 'RpcMonitorService');
this.logger.logRpcActivity(endpoint.url, 'Health check passed', latency);

// ❌ Avoid
this.logger.log('Connection established'); // Missing context
```

### 3. **Use Metadata for Structured Logging**

```typescript
// ✅ Good
this.logger.logBlockchainActivity(chainId, 'Block processed', {
  blockNumber: block.number,
  transactionCount: block.transactions.length,
  gasUsed: block.gasUsed,
});

// ❌ Avoid
this.logger.log(`Block ${block.number} processed with ${block.transactions.length} transactions`);
```

### 4. **Handle Errors Properly**

```typescript
// ✅ Good
try {
  await riskyOperation();
  this.logger.log('Operation completed successfully', 'ServiceName');
} catch (error) {
  this.logger.error('Operation failed', error.stack, 'ServiceName');
  // Handle the error...
}

// ❌ Avoid
try {
  await riskyOperation();
} catch (error) {
  this.logger.log('Something went wrong'); // Not descriptive enough
}
```

## Integration with Existing Code

The new logging system is designed to work alongside existing NestJS Logger usage:

```typescript
// Old way (still works)
import { Logger } from '@nestjs/common';
private readonly logger = new Logger(MyService.name);

// New way (enhanced features)
import { CustomLoggerService } from '@logging/logger.service';
constructor(private readonly logger: CustomLoggerService) {}
```

## Features

- **Automatic Rotation**: Files rotate when size limits are reached
- **Multiple Transports**: Console and file outputs simultaneously
- **Structured Logging**: JSON metadata support
- **Exception Handling**: Captures uncaught exceptions and promise rejections
- **Context Support**: Service/component identification
- **Performance Monitoring**: Built-in latency and metrics logging

## Log Retention

- **Active logs**: Kept until rotation limits are reached
- **Archived logs**: Manually managed in `logs/archive/` directory
- **Recommendation**: Archive logs monthly or before major updates

## Troubleshooting

### No Log Files Created

```bash
# Check permissions
ls -la logs/
# Should show read/write permissions

# Check if app is starting
npm run start:dev
# Look for "Logger initialized" message
```

### No logs being created

1. Check that the application has write permissions to the `logs/` directory
2. Verify the `LOG_LEVEL` environment variable is set correctly
3. Ensure the application is starting successfully

### Large log files

1. With daily organization, each day starts fresh - no more huge rotating files
2. Monitor disk space: `yarn logs:size` to see total and daily breakdown
3. Archive old logs if needed: `yarn logs:archive`
4. Clean up old days automatically: `yarn logs:cleanup-old` (removes logs older than 30 days)
5. For unlimited storage servers, this system is optimal for investigation

### Missing Debug Logs

```bash
# Ensure debug level is set
echo $LOG_LEVEL
# Should show 'debug'

# Set debug level and restart
LOG_LEVEL=debug npm run start:dev
```

### Missing specific logs

1. **No error.log**: No errors occurred (good!)
2. **No debug.log**: Debug level not enabled
3. **No exceptions.log**: No uncaught exceptions (good!)

## Integration with Monitoring Tools

These logs can be integrated with external monitoring solutions:

- **ELK Stack** (Elasticsearch, Logstash, Kibana)
- **Splunk**
- **Datadog**
- **New Relic**
- **Grafana Loki**

The structured JSON metadata in logs makes them easy to parse and analyze.

### Log Parsing and Analysis

The structured JSON format makes logs easy to parse:

```bash
# Extract all metadata from logs
grep -o '{"[^}]*"}' logs/combined.log | jq .

# Get all RPC latency measurements
grep "RPC.*latency" logs/combined.log | grep -o '[0-9]*ms'
```

## Advanced Usage

### Custom Log Transports

The Winston logger can be extended with additional transports:

```typescript
// In logger.service.ts, you can add:
// - Database logging
// - Remote syslog
// - Slack notifications
// - Email alerts
```

## Migration from Old Logging

If you were previously using console.log or basic Logger:

```typescript
// Old
console.log('Starting process...');
this.logger.log('Process completed');

// New
this.logger.log('Starting process...', 'ServiceName');
this.logger.logMonitoringActivity('SERVICE', 'Process completed');
```

This comprehensive logging system ensures all application activity is properly recorded, rotated, and easily accessible for debugging and monitoring purposes.
